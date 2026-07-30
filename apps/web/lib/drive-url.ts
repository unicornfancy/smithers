/**
 * Google Drive URL parsing.
 *
 * Drive/Docs/Sheets/Slides URLs come in several shapes that all embed
 * a file id in the same position. Extract it once, use it everywhere:
 *   https://docs.google.com/document/d/<id>/edit
 *   https://docs.google.com/spreadsheets/d/<id>/edit#gid=0
 *   https://docs.google.com/presentation/d/<id>/edit
 *   https://drive.google.com/file/d/<id>/view
 *   https://drive.google.com/open?id=<id>
 *
 * Folder URLs (`/folders/<id>`) are intentionally NOT returned here —
 * those go through parseDriveFolderId in the workbench for activity
 * ingestion, and treating them as file ids would silently mis-fetch.
 *
 * Lives in apps/web so client + server code can share it without
 * dragging in the mcp-client barrel (which pulls transport-level
 * deps into the client bundle).
 */
export function parseDriveFileId(url: string | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const dMatch = /\/(?:document|spreadsheets|presentation|file)\/d\/([A-Za-z0-9_-]+)/.exec(
    trimmed,
  );
  if (dMatch) return dMatch[1] ?? null;
  const openMatch = /[?&]id=([A-Za-z0-9_-]+)/.exec(trimmed);
  return openMatch?.[1] ?? null;
}
