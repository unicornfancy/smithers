import "server-only";

import { getMcpClient } from "./mcp";
import { readMyVoiceFile, writeMyVoiceFile } from "./my-voice";

const CHARTER_FILENAME = "TEAM_CHARTER.md";
const BEGIN_MARKER = "<!-- BEGIN team-charter-sync -->";
const END_MARKER = "<!-- END team-charter-sync -->";

export interface TeamCharterSyncResult {
  /** True when the file was actually rewritten (false on no-op or skip). */
  changed: boolean;
  /** Source: which sheet tab we pulled. */
  source_url: string;
  /** Row count in the rendered table. */
  rows: number;
  /** ISO timestamp the sync ran. */
  synced_at: string;
}

export interface TeamCharterSyncInput {
  /** Full Google Sheets URL. We parse the file id + gid out of it. */
  sheet_url: string;
}

/**
 * Pull the configured tab of a team-charter Google Sheet via the
 * Drive client's `exportSheetCsv` helper, convert CSV → markdown
 * table, and write into `my-voice/TEAM_CHARTER.md` between auto-managed
 * BEGIN/END markers so anything the user adds outside the markers
 * survives the next sync.
 *
 * Idempotent: re-running with the same sheet content is a no-op
 * (changed: false). The check compares the rendered block, not the
 * raw CSV — that way a cosmetic CSV-formatting change that produces
 * an identical markdown table won't churn the file.
 */
export async function syncTeamCharter(
  input: TeamCharterSyncInput,
): Promise<TeamCharterSyncResult> {
  const { fileId, gid } = parseSheetUrl(input.sheet_url);
  const mcp = await getMcpClient();
  const csv = await mcp.googleDrive.exportSheetCsv({ fileId, gid });
  const rows = parseCsv(csv);
  const table = renderMarkdownTable(rows);
  const block = `${BEGIN_MARKER}\n\n_Auto-synced from the team charter Google Sheet. Edit the sheet, not this block — your edits here will be overwritten on the next sync._\n\n_Source: <${input.sheet_url}>_\n\n${table}\n\n${END_MARKER}`;

  const existing = (await readMyVoiceFile(CHARTER_FILENAME)) ?? "";
  const next = upsertMarkedBlock(existing, block);
  const syncedAt = new Date().toISOString();
  if (existing === next) {
    return {
      changed: false,
      source_url: input.sheet_url,
      rows: rows.length > 0 ? rows.length - 1 : 0,
      synced_at: syncedAt,
    };
  }
  await writeMyVoiceFile(CHARTER_FILENAME, next);
  return {
    changed: true,
    source_url: input.sheet_url,
    rows: rows.length > 0 ? rows.length - 1 : 0,
    synced_at: syncedAt,
  };
}

/**
 * Parse a Google Sheets URL into (file id, tab gid). Accepts either
 * the "edit" form with `#gid=...` or the parameterized `?gid=...`.
 * Throws on a URL we can't recognize.
 */
function parseSheetUrl(url: string): { fileId: string; gid: string } {
  const fileMatch = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(url);
  if (!fileMatch?.[1]) {
    throw new Error(`Could not extract file id from sheet URL: ${url}`);
  }
  const gidMatch = /[?#&]gid=(\d+)/.exec(url);
  const gid = gidMatch?.[1] ?? "0";
  return { fileId: fileMatch[1], gid };
}

/**
 * Minimal CSV parser that handles quoted cells with embedded commas
 * and quote-escaped quotes. We avoid pulling in a CSV dependency for
 * this small surface — the format from Drive's export is well-formed.
 */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && csv[i + 1] === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += c;
      }
    }
  }
  // Trailing cell / row.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop any fully-empty trailing rows.
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c.trim() === "")) {
    rows.pop();
  }
  return rows;
}

function renderMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return "_(empty sheet)_";
  // Normalize columns to the widest row.
  const colCount = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => {
    const padded = [...r];
    while (padded.length < colCount) padded.push("");
    return padded.map((c) => escapeCell(c));
  });
  const header = norm[0]!;
  const separator = header.map(() => "---");
  const body = norm.slice(1);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ];
  return lines.join("\n");
}

function escapeCell(cell: string): string {
  // Newlines inside a cell would break the markdown table — replace
  // with `<br>`. Pipes inside a cell are literal in markdown unless
  // escaped — escape them.
  return cell.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|").trim();
}

/**
 * Replace the BEGIN/END block in `source` with `block`. If markers
 * aren't there yet, append the block (preceded by an H1 if the file is
 * brand new) so users start with a sensible-looking doc.
 */
function upsertMarkedBlock(source: string, block: string): string {
  if (source.includes(BEGIN_MARKER) && source.includes(END_MARKER)) {
    const before = source.slice(0, source.indexOf(BEGIN_MARKER));
    const afterStart = source.indexOf(END_MARKER) + END_MARKER.length;
    const after = source.slice(afterStart);
    return `${before}${block}${after}`;
  }
  if (!source.trim()) {
    return `# Team Charter\n\nThe rubric your work is evaluated against. The block below is auto-synced from the team charter Google Sheet. Add personal notes / interpretations OUTSIDE the markers — they survive the next sync.\n\n${block}\n`;
  }
  const sep = source.endsWith("\n") ? "" : "\n";
  return `${source}${sep}\n${block}\n`;
}
