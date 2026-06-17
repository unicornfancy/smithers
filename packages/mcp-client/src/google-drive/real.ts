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
          const escapedSince = query.since.replace(/'/g, "\\'");
          const q = `'${query.folder_id}' in parents and modifiedTime > '${escapedSince}' and trashed = false`;
          const result = await this.mcp.callJsonTool<DriveSearchResult>(
            "search",
            {
              query: q,
              pageSize: limit,
              excludeContentSnippets: true,
            },
          );
          const files = collectFiles(result);
          if (result?.error?.message) {
            throw new Error(result.error.message);
          }
          return mapFilesToActivity(files, query);
        },
      },
    );
  }
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
