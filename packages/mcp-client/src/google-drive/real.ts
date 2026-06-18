import { readFileSync } from "node:fs";

import { google, type drive_v3 } from "googleapis";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

import type { SwrCache } from "../cache";
import type { ResolvedMcpClientOptions } from "../config";
import type { HealthRegistry } from "../health";
import { runIsolated } from "../isolation";
import type { ActivityEvent, SourceResult } from "../types";

import type {
  DriveFolderActivityQuery,
  GoogleDriveClient,
} from "./types";

const DRIVE_ACTIVITY_TTL = { freshMs: 5 * 60 * 1000 } as const;
// Drive's `q` has no transitive ancestor query — we crawl breadth-first
// up to these bounds, then issue one combined search across all
// discovered folder IDs. Bounds keep worst-case fanout bounded for
// projects with very deep folder trees.
const MAX_SUBFOLDER_CRAWL_DEPTH = 4;
const MAX_SUBFOLDER_CRAWL_COUNT = 100;
const MAX_PARENTS_PER_SEARCH = 30;

const FILES_FIELDS =
  "files(id,name,mimeType,modifiedTime,webViewLink,driveId,lastModifyingUser(displayName,emailAddress),owners(displayName,emailAddress))";

/**
 * Direct Google Drive API client.
 *
 * We don't use `@modelcontextprotocol/server-gdrive` — its `search`
 * tool hardcodes `fullText contains '<query>'`, returns plain-text
 * snippets only, ignores shared-drive flags, and caps at 10 results.
 * Instead we mint an OAuth2 client from the same credentials files
 * the MCP server's `auth` flow already produced and call
 * `drive.files.list` directly via the `googleapis` package.
 *
 * The auto-refresh behavior of `OAuth2Client` means the cached
 * `gdrive-server-credentials.json` only needs to hold a valid
 * `refresh_token` — access tokens are refreshed transparently.
 */
export class RealGoogleDriveTransport implements GoogleDriveClient {
  private drive: drive_v3.Drive | null = null;
  private initError: string | null = null;

  constructor(
    private readonly opts: ResolvedMcpClientOptions,
    private readonly cache: SwrCache,
    private readonly health: HealthRegistry,
  ) {}

  async listFolderActivity(
    query: DriveFolderActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>> {
    const limit = Math.min(query.limit ?? 20, 50);
    const cacheKey = `real:google_drive:folder_activity:${query.folder_id}:${query.since}:${limit}`;
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "google_drive",
        cacheKey,
        ttl: DRIVE_ACTIVITY_TTL,
        fetcher: async () => {
          const drive = this.ensureClient();
          // Breadth-first crawl so subfolder activity surfaces. Drive
          // has no transitive ancestor query — we have to discover the
          // folder tree ourselves.
          const folderIds = await crawlSubfolders(drive, query.folder_id);
          // OR all parent clauses into one search per chunk; results
          // run concurrently and merge.
          const escapedSince = query.since.replace(/'/g, "\\'");
          const chunks = chunk(folderIds, MAX_PARENTS_PER_SEARCH);
          const results = await Promise.all(
            chunks.map((parentIds) =>
              searchFilesWithSharedDriveSupport(drive, {
                parentIds,
                modifiedSince: escapedSince,
                pageSize: limit,
              }),
            ),
          );
          const merged = results.flat();
          const seen = new Set<string>();
          const unique: drive_v3.Schema$File[] = [];
          for (const f of merged) {
            if (!f.id || seen.has(f.id)) continue;
            seen.add(f.id);
            unique.push(f);
          }
          return mapFilesToActivity(unique, query).slice(0, limit);
        },
      },
    );
  }

  private ensureClient(): drive_v3.Drive {
    if (this.drive) return this.drive;
    if (this.initError) throw new Error(this.initError);
    try {
      const oauth = buildOAuthClient(
        this.opts.googleDriveOAuthPath,
        this.opts.googleDriveCredsPath,
      );
      this.drive = google.drive({ version: "v3", auth: oauth });
      return this.drive;
    } catch (err) {
      this.initError =
        err instanceof Error ? err.message : "Failed to init Google Drive client";
      throw new Error(this.initError);
    }
  }
}

function buildOAuthClient(
  oauthKeysPath: string | null,
  credsPath: string | null,
): OAuth2Client {
  if (!oauthKeysPath) throw new Error("googleDriveOAuthPath not configured");
  if (!credsPath) throw new Error("googleDriveCredsPath not configured");
  const keys = JSON.parse(readFileSync(oauthKeysPath, "utf-8")) as {
    installed?: { client_id?: string; client_secret?: string; redirect_uris?: string[] };
    web?: { client_id?: string; client_secret?: string; redirect_uris?: string[] };
  };
  const installed = keys.installed ?? keys.web;
  if (!installed?.client_id || !installed?.client_secret) {
    throw new Error(
      "OAuth keys file is missing client_id/client_secret (expected {installed|web: {...}})",
    );
  }
  const creds = JSON.parse(readFileSync(credsPath, "utf-8")) as {
    refresh_token?: string;
    access_token?: string;
    expiry_date?: number;
    scope?: string;
    token_type?: string;
  };
  if (!creds.refresh_token) {
    throw new Error(
      "Cached credentials file is missing refresh_token — re-run the gdrive auth flow",
    );
  }
  const oauth = new google.auth.OAuth2(
    installed.client_id,
    installed.client_secret,
    installed.redirect_uris?.[0] ?? "http://localhost",
  );
  oauth.setCredentials({
    refresh_token: creds.refresh_token,
    access_token: creds.access_token,
    expiry_date: creds.expiry_date,
    scope: creds.scope,
    token_type: creds.token_type,
  });
  return oauth;
}

/**
 * Single `files.list` call that supports both My Drive and Shared
 * Drives. The flag trio (`supportsAllDrives`, `includeItemsFromAllDrives`,
 * `corpora: "allDrives"`) is required for shared-drive content to come
 * back; without them the API silently filters to My Drive only.
 */
async function searchFilesWithSharedDriveSupport(
  drive: drive_v3.Drive,
  args: {
    parentIds: string[];
    modifiedSince: string;
    pageSize: number;
  },
): Promise<drive_v3.Schema$File[]> {
  if (args.parentIds.length === 0) return [];
  const parentsClause = args.parentIds
    .map((id) => `'${id}' in parents`)
    .join(" or ");
  const q = `(${parentsClause}) and modifiedTime > '${args.modifiedSince}' and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
  const res = await drive.files.list({
    q,
    pageSize: args.pageSize,
    fields: `nextPageToken,${FILES_FIELDS}`,
    orderBy: "modifiedTime desc",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });
  return res.data.files ?? [];
}

/**
 * Breadth-first crawl: starting at `rootId`, find every descendant
 * folder up to depth/count bounds and return the full set of folder
 * IDs (root included). Required because Drive has no transitive
 * ancestor query.
 */
async function crawlSubfolders(
  drive: drive_v3.Drive,
  rootId: string,
): Promise<string[]> {
  const discovered = new Set<string>([rootId]);
  let frontier: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  while (frontier.length > 0 && discovered.size < MAX_SUBFOLDER_CRAWL_COUNT) {
    const next: Array<{ id: string; depth: number }> = [];
    const childResults = await Promise.all(
      frontier
        .filter((n) => n.depth < MAX_SUBFOLDER_CRAWL_DEPTH)
        .map(async (n) => {
          const q = `'${n.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
          const res = await drive.files
            .list({
              q,
              pageSize: 200,
              fields: "files(id)",
              supportsAllDrives: true,
              includeItemsFromAllDrives: true,
              corpora: "allDrives",
            })
            .catch(() => ({ data: { files: [] as drive_v3.Schema$File[] } }));
          return {
            depth: n.depth + 1,
            files: res.data.files ?? [],
          };
        }),
    );
    for (const { depth, files } of childResults) {
      for (const f of files) {
        if (!f.id || discovered.has(f.id)) continue;
        discovered.add(f.id);
        next.push({ id: f.id, depth });
        if (discovered.size >= MAX_SUBFOLDER_CRAWL_COUNT) break;
      }
    }
    frontier = next;
  }
  return Array.from(discovered);
}

function chunk<T>(xs: T[], size: number): T[][] {
  if (xs.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) {
    out.push(xs.slice(i, i + size));
  }
  return out;
}

function mapFilesToActivity(
  files: drive_v3.Schema$File[],
  query: DriveFolderActivityQuery,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const f of files) {
    if (!f.id || !f.modifiedTime) continue;
    const actor = f.lastModifyingUser ?? f.owners?.[0];
    events.push({
      id: `drive:${f.id}:${f.modifiedTime}`,
      source: "google_drive",
      kind: "drive-file",
      timestamp: f.modifiedTime,
      actor: actor
        ? {
            name: actor.displayName ?? actor.emailAddress ?? "Unknown",
            handle: actor.emailAddress ?? undefined,
            // We can't reliably tell internal vs external from
            // Drive's user metadata; default to false. The activity
            // feed doesn't currently bias on this for Drive rows.
            is_external: false,
          }
        : undefined,
      title: f.name ?? "(untitled)",
      excerpt: friendlyMimeLabel(f.mimeType),
      url: f.webViewLink ?? undefined,
      project_match: {
        project_slug: query.project_slug,
        matched_by: "p2_url",
        display_label: query.project_display ?? query.project_slug,
        in_vault: true,
      },
      is_mock: false,
    });
  }
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return events;
}

/**
 * Map common Drive mimeTypes to a short label for the activity row
 * excerpt. Unknown types fall back to the raw mimeType so we don't
 * silently drop signal.
 */
function friendlyMimeLabel(mimeType: string | null | undefined): string {
  if (!mimeType) return "Drive file";
  if (mimeType === "application/vnd.google-apps.document") return "Google Doc";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "Google Sheet";
  if (mimeType === "application/vnd.google-apps.presentation") return "Google Slides";
  if (mimeType === "application/vnd.google-apps.folder") return "Folder";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.startsWith("video/")) return "Video";
  return mimeType;
}
