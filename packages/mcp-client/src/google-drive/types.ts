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

  /**
   * Export a specific tab of a Google Sheet as CSV. Used by the
   * team-charter sync to ingest the relevant tab without pulling in
   * other tabs (e.g. changelog tab). Returns the raw CSV body; the
   * caller is responsible for parsing into a markdown table.
   *
   * Uses the public-style export URL (`/export?format=csv&gid=...`)
   * authenticated via the existing OAuth token — no extra Sheets API
   * scope required.
   */
  exportSheetCsv(args: { fileId: string; gid: string }): Promise<string>;

  /**
   * Fetch a Drive file's contents as a text body. Used by the brief
   * generator to inline the Discovery Doc when the user pastes a
   * Drive URL instead of the doc contents. Handles Google Docs
   * (exported to Markdown), Sheets (CSV), Slides (plain-text
   * transcript), and uploaded files (raw bytes as UTF-8 for text/*
   * or PDF; other binary types throw). Throws on missing perms /
   * unknown fileId / MCP disabled — caller falls back to the
   * URL-only path.
   */
  fetchDocContent(args: { fileId: string }): Promise<{
    content: string;
    /** Original mimeType so caller can label the content in context. */
    mimeType: string;
    /** File name from Drive metadata (may be undefined). */
    name?: string;
  }>;
}
