import type { SwrCache } from "../cache";
import type { ResolvedMcpClientOptions } from "../config";
import type { HealthRegistry } from "../health";
import { runIsolated } from "../isolation";
import { StdioMcpClient } from "../stdio-mcp";
import type { ActivityEvent, SourceResult } from "../types";

import type {
  DriveFolderActivityQuery,
  GoogleDriveClient,
} from "./types";

const DRIVE_ACTIVITY_TTL = { freshMs: 5 * 60 * 1000 } as const;
// Drive has no recursive folder query — we crawl breadth-first up to
// these bounds, then issue a single combined search across all
// discovered folder IDs. Bounds keep worst-case fanout sane for
// projects with very deep folder trees.
const MAX_SUBFOLDER_CRAWL_DEPTH = 4;
const MAX_SUBFOLDER_CRAWL_COUNT = 50;
const MAX_PARENTS_PER_SEARCH = 30;

interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  modifiedTime?: string;
  /** Last-known modifier. The Drive API returns this only when the field is requested in `fields`. */
  lastModifyingUser?: {
    displayName?: string;
    emailAddress?: string;
  };
  /** Owners — used as a fallback when lastModifyingUser is missing. */
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
}

interface DriveSearchResult {
  /** `@modelcontextprotocol/server-gdrive` returns either `files` or wraps under `result.files`. */
  files?: DriveFile[];
  result?: { files?: DriveFile[] };
  nextPageToken?: string;
  /** Some MCP wrappers surface this when the upstream API isn't reachable. */
  error?: { message?: string };
}

export class RealGoogleDriveTransport implements GoogleDriveClient {
  private readonly mcp: StdioMcpClient;

  constructor(
    private readonly opts: ResolvedMcpClientOptions,
    private readonly cache: SwrCache,
    private readonly health: HealthRegistry,
  ) {
    // The official Drive MCP reads OAuth keys + cached creds from the
    // two env vars below. Note the asymmetry: GDRIVE_OAUTH_PATH (no
    // "S") but GDRIVE_CREDENTIALS_PATH (full word) — confirmed against
    // the @modelcontextprotocol/server-gdrive@2025.1.14 source. We pass
    // explicit paths so the server doesn't write next to its own dist.
    const env: Record<string, string> = {};
    if (opts.googleDriveOAuthPath) env.GDRIVE_OAUTH_PATH = opts.googleDriveOAuthPath;
    if (opts.googleDriveCredsPath) env.GDRIVE_CREDENTIALS_PATH = opts.googleDriveCredsPath;
    this.mcp = new StdioMcpClient({
      label: "google-drive",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-gdrive"],
      env,
    });
  }

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
          // 1) Crawl the folder tree breadth-first so we can include
          //    files in nested subfolders. Drive's API has no
          //    transitive ancestor query, so this is required to avoid
          //    missing activity in `<project>/Designs/v2/` etc.
          const folderIds = await this.crawlSubfolders(query.folder_id);
          // 2) Build one or more searches that OR together the parent
          //    clauses. Drive's q-string can hold a lot but we chunk
          //    defensively at MAX_PARENTS_PER_SEARCH so the request
          //    body doesn't get rejected on very deep trees.
          const escapedSince = query.since.replace(/'/g, "\\'");
          const chunks = chunk(folderIds, MAX_PARENTS_PER_SEARCH);
          const results = await Promise.all(
            chunks.map(async (parentIds) => {
              const parentsClause = parentIds
                .map((id) => `'${id}' in parents`)
                .join(" or ");
              const q = `(${parentsClause}) and modifiedTime > '${escapedSince}' and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
              const result = await this.mcp.callJsonTool<DriveSearchResult>(
                "search",
                {
                  query: q,
                  pageSize: limit,
                  excludeContentSnippets: true,
                },
              );
              if (result?.error?.message) {
                throw new Error(result.error.message);
              }
              return collectFiles(result);
            }),
          );
          const merged = results.flat();
          // Dedup by file id (same file can show up under multiple
          // parents in shared-drive scenarios), then map.
          const seen = new Set<string>();
          const unique: DriveFile[] = [];
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

  /**
   * Breadth-first crawl: starting at `rootId`, find every descendant
   * folder up to depth/count bounds and return the full set of folder
   * IDs (root included). This is the only way to handle "recursive"
   * listings in Drive — the API has no transitive parent query.
   */
  private async crawlSubfolders(rootId: string): Promise<string[]> {
    const discovered = new Set<string>([rootId]);
    const queue: Array<{ id: string; depth: number }> = [
      { id: rootId, depth: 0 },
    ];
    while (queue.length > 0 && discovered.size < MAX_SUBFOLDER_CRAWL_COUNT) {
      const layer = queue.splice(0, queue.length);
      // Issue one search per parent in this layer — Drive returns
      // child folders for that parent only. The MCP call is cheap and
      // we can run them concurrently per layer.
      const childLists = await Promise.all(
        layer
          .filter((n) => n.depth < MAX_SUBFOLDER_CRAWL_DEPTH)
          .map(async (n) => {
            const q = `'${n.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
            const result = await this.mcp
              .callJsonTool<DriveSearchResult>("search", {
                query: q,
                pageSize: 100,
                excludeContentSnippets: true,
              })
              .catch(() => null);
            return {
              depth: n.depth + 1,
              files: collectFiles(result),
            };
          }),
      );
      for (const { depth, files } of childLists) {
        for (const f of files) {
          if (!f.id || discovered.has(f.id)) continue;
          discovered.add(f.id);
          queue.push({ id: f.id, depth });
          if (discovered.size >= MAX_SUBFOLDER_CRAWL_COUNT) break;
        }
      }
    }
    return Array.from(discovered);
  }
}

function chunk<T>(xs: T[], size: number): T[][] {
  if (xs.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) {
    out.push(xs.slice(i, i + size));
  }
  return out;
}

function collectFiles(result: DriveSearchResult | null): DriveFile[] {
  if (!result) return [];
  if (Array.isArray(result.files)) return result.files;
  if (Array.isArray(result.result?.files)) return result.result.files;
  return [];
}

function mapFilesToActivity(
  files: DriveFile[],
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
            handle: actor.emailAddress,
            is_external: false,
          }
        : undefined,
      title: f.name ?? "(untitled)",
      excerpt: friendlyMimeLabel(f.mimeType),
      url: f.webViewLink,
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
 * Map common Drive mimeTypes to a short label for the activity-row
 * excerpt. Unknown types fall back to the raw mimeType so we don't
 * silently drop signal.
 */
function friendlyMimeLabel(mimeType?: string): string {
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
