import type { ActivityEvent, SourceResult } from "../types";

/**
 * Activity inside a single Drive folder. Maps each file's
 * `modifiedTime` to a `drive-file` ActivityEvent so the workbench's
 * Live Activity feed can render it alongside Slack / GitHub / etc.
 */
export interface DriveFolderActivityQuery {
  /** Drive folder ID, parsed from the project's `google_drive_url`. */
  folder_id: string;
  /** Vault project slug — written into the resulting events' project_match. */
  project_slug: string;
  /** Display label for the project, falling back to project_slug. */
  project_display?: string;
  /** Lookback window. Drive's `search` filters server-side via `modifiedTime > <iso>`. */
  since: string;
  /** Max events to return; the MCP's pageSize is clamped to 50 below this. */
  limit?: number;
}

export interface GoogleDriveClient {
  /**
   * Pull recently-modified files in the given Drive folder. Returns
   * them in newest-first order, normalized as ActivityEvent. Degrades
   * gracefully on missing config / auth errors via SourceResult.
   */
  listFolderActivity(
    query: DriveFolderActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>>;
}
