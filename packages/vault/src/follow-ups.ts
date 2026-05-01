import type { ResolvedVaultOptions } from "./config";
import { tryReadFile, writeFileAtomic } from "./fs";
import { deterministicId } from "./ids";
import { vaultPaths } from "./paths";
import type { FollowUp, FollowUpStatus, Project } from "./types";

/**
 * Parse the user's `Follow-ups.md` table-style tracker into structured rows.
 *
 * The existing layout has two h2 sections — "Open Follow-ups" and "Resolved" —
 * each containing a markdown pipe table with these columns:
 *
 *     | Project | Task | Sent | Follow-up By | Status | Source |
 *
 * We tolerate small drift in column order/spacing and use the header row to
 * map columns by name. Rows whose status starts with "✅" go to resolved
 * regardless of which section they're in.
 */
export async function listFollowUps(
  opts: ResolvedVaultOptions,
): Promise<{ active: FollowUp[]; resolved: FollowUp[] }> {
  const paths = vaultPaths(opts);
  const raw = await tryReadFile(paths.followUps);
  if (!raw) return { active: [], resolved: [] };

  const rows = parseAllTables(raw);
  const active: FollowUp[] = [];
  const resolved: FollowUp[] = [];
  for (const row of rows) {
    if (row.status === "resolved") resolved.push(row);
    else active.push(row);
  }
  // Newest-sent first within each list.
  active.sort((a, b) => (b.sent ?? "").localeCompare(a.sent ?? ""));
  resolved.sort((a, b) => (b.sent ?? "").localeCompare(a.sent ?? ""));
  return { active, resolved };
}

/**
 * Pick the follow-ups that belong to a given project, fuzzily.
 *
 * Matches on a few candidate strings derived from the project — its name,
 * its slug, and (for partner-kind) the partner slug. The follow-up's
 * `project` cell is free-form text the user wrote, so we tolerate small
 * variants like "ClimateFirst Foundation" vs "ClimateFirst" by checking
 * either-direction substring containment after lower-casing.
 */
export function filterFollowUpsForProject<T extends FollowUp>(
  rows: T[],
  project: Pick<Project, "name" | "slug" | "partner">,
): T[] {
  const candidates = [project.name, project.partner, deslug(project.slug)]
    .filter((s): s is string => Boolean(s))
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s.length >= 3);
  if (candidates.length === 0) return [];
  return rows.filter((r) => {
    const cell = r.project.toLowerCase().trim();
    return candidates.some((c) => cell.includes(c) || c.includes(cell));
  });
}

function deslug(slug: string): string {
  return slug.replace(/-/g, " ");
}

export interface ResolveFollowUpResult {
  follow_up_id: string;
  /** True when the file was rewritten; false when already resolved. */
  changed: boolean;
}

/**
 * Mark a follow-up row as resolved by flipping its Status cell in
 * `Follow-ups.md`. Matches the row by the same content-derived
 * `follow_up_id` the parser uses (project + task + sent), so a
 * stale id from the UI still resolves as long as those three
 * fields haven't changed.
 *
 * Intentionally does *not* move the row from "Open" to "Resolved"
 * tables — those tables have different columns and trying to
 * remap on the fly is brittle. The classifier reads from the
 * Status cell text, so the UI shows the row as resolved
 * regardless of which section it physically lives in.
 */
export async function resolveFollowUp(
  opts: ResolvedVaultOptions,
  followUpId: string,
  note?: string,
): Promise<ResolveFollowUpResult> {
  const paths = vaultPaths(opts);
  const raw = await tryReadFile(paths.followUps);
  if (raw === null) {
    throw new Error(`Follow-ups.md not found at ${paths.followUps}`);
  }

  const lines = raw.split(/\r?\n/);
  // Walk lines; for each table row, parse cells against the closest
  // preceding header row to compute the deterministic id and look for
  // a match. We rebuild the file line-by-line; only the matched row
  // gets a rewritten Status cell.
  let header: string[] | null = null;
  let foundLineIndex = -1;
  let foundCells: string[] | null = null;
  let foundStatusCol = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trimStart().startsWith("|")) continue;
    if (isSeparatorRow(line.trim())) continue;
    const cells = splitRow(line);
    // The first table row we encounter (or the row right after a
    // gap) is treated as a header. Headers contain "project" + "task"
    // somewhere — that's how we distinguish them from data rows.
    const lower = cells.map((c) => c.toLowerCase());
    const looksLikeHeader =
      lower.includes("project") && lower.includes("task");
    if (looksLikeHeader) {
      header = lower;
      continue;
    }
    if (!header) continue;
    const project = cellByName(cells, header, "project");
    const task = cellByName(cells, header, "task");
    const sent = cellByName(cells, header, "sent");
    if (!project || !task) continue;
    const id = deterministicId(project, task, sent);
    if (id !== followUpId) continue;

    foundLineIndex = i;
    foundCells = cells;
    foundStatusCol = header.indexOf("status");
    break;
  }

  if (foundLineIndex < 0 || !foundCells) {
    throw new Error(
      `Follow-up ${followUpId} not found in Follow-ups.md`,
    );
  }
  if (foundStatusCol < 0) {
    // No Status column in this table (e.g. the "Resolved" table uses
    // different columns). Treat as already-resolved no-op rather than
    // an error since the row exists.
    return { follow_up_id: followUpId, changed: false };
  }

  const currentStatus = foundCells[foundStatusCol] ?? "";
  if (classifyStatus(currentStatus) === "resolved") {
    return { follow_up_id: followUpId, changed: false };
  }

  const today = new Date().toISOString().slice(0, 10);
  const newStatus = note
    ? `✅ Resolved — ${note}`
    : `✅ Resolved ${today}`;
  foundCells[foundStatusCol] = newStatus;
  // Rebuild the row preserving the original leading/trailing pipe
  // style. Most tables have leading + trailing pipes; mirror that.
  lines[foundLineIndex] = `| ${foundCells.join(" | ")} |`;

  await writeFileAtomic(paths.followUps, lines.join("\n"));
  return { follow_up_id: followUpId, changed: true };
}

function cellByName(
  cells: string[],
  header: string[],
  name: string,
): string {
  const idx = header.indexOf(name);
  return idx >= 0 ? (cells[idx] ?? "") : "";
}

export interface AppendFollowUpInput {
  /** Free-text project name as it appears in the Project column. */
  project: string;
  /** What you owe / are waiting on. */
  task: string;
  /** YYYY-MM-DD when the follow-up was effectively sent (today by default). */
  sent?: string;
  /** YYYY-MM-DD by when you want a reply. */
  follow_up_by?: string;
  /** Optional source link or note (e.g. "[[Call Notes/2026-05-01]]"). */
  source?: string;
}

export interface AppendFollowUpResult {
  follow_up_id: string;
  /** Where in the table the new row landed (1-based row number among data rows). */
  row_number: number;
}

/**
 * Append a row to the "Open Follow-ups" table in Follow-ups.md. Creates
 * the file from a sensible default if it doesn't exist yet. Atomic write.
 *
 * The row is added at the bottom of the Open Follow-ups table — same
 * shape the parser expects (Project | Task | Sent | Follow-up By |
 * Status | Source), so listFollowUps will see it on the next read.
 */
export async function appendFollowUp(
  opts: ResolvedVaultOptions,
  input: AppendFollowUpInput,
): Promise<AppendFollowUpResult> {
  if (!input.project.trim()) {
    throw new Error("project is required");
  }
  if (!input.task.trim()) {
    throw new Error("task is required");
  }
  const today = new Date().toISOString().slice(0, 10);
  const sent = (input.sent ?? today).trim();
  const followUpBy = (input.follow_up_by ?? "").trim();
  const source = (input.source ?? "").trim();

  const paths = vaultPaths(opts);
  const raw = (await tryReadFile(paths.followUps)) ?? defaultFollowUpsBody();

  const lines = raw.split(/\r?\n/);
  // Find the Open Follow-ups header row + insert after the last data row.
  let openHeaderIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trimStart().startsWith("|")) continue;
    if (isSeparatorRow(line.trim())) continue;
    const cells = splitRow(line).map((c) => c.toLowerCase());
    if (cells.includes("project") && cells.includes("task") && cells.includes("status")) {
      openHeaderIdx = i;
      break;
    }
  }
  if (openHeaderIdx < 0) {
    throw new Error(
      `Couldn't find an Open Follow-ups header row in Follow-ups.md`,
    );
  }
  // Walk forward from the header to the end of this contiguous table.
  let lastTableLineIdx = openHeaderIdx;
  for (let i = openHeaderIdx + 1; i < lines.length; i++) {
    if (lines[i]!.trimStart().startsWith("|")) {
      lastTableLineIdx = i;
    } else {
      break;
    }
  }
  const headerCells = splitRow(lines[openHeaderIdx]!).map((c) => c.toLowerCase());
  const newRow = renderRow(headerCells, {
    project: input.project.trim(),
    task: input.task.trim(),
    sent,
    "follow-up by": followUpBy,
    status: "⏳ Waiting",
    source,
  });
  lines.splice(lastTableLineIdx + 1, 0, newRow);
  await writeFileAtomic(paths.followUps, lines.join("\n"));

  return {
    follow_up_id: deterministicId(input.project.trim(), input.task.trim(), sent),
    row_number: lastTableLineIdx + 1 - openHeaderIdx,
  };
}

function renderRow(
  headerCells: string[],
  values: Record<string, string>,
): string {
  const cells = headerCells.map((h) => values[h] ?? "");
  return `| ${cells.join(" | ")} |`;
}

function defaultFollowUpsBody(): string {
  return `# Follow-ups Tracker
*Managed automatically by Smithers. Add rows manually if needed. Mark Status as ✅ Resolved when a response is received.*

---

## Open Follow-ups

| Project | Task | Sent | Follow-up By | Status | Source |
|---|---|---|---|---|---|

---

## Resolved Follow-ups

| Project | Task | Sent | Resolved | Notes |
|---|---|---|---|---|
`;
}

// --- internals ---

interface ParsedRow {
  cells: Record<string, string>;
  raw: string;
}

function parseAllTables(markdown: string): FollowUp[] {
  const rows: FollowUp[] = [];
  const tables = extractTables(markdown);
  for (const table of tables) {
    for (const parsed of parseRows(table)) {
      const row = rowToFollowUp(parsed);
      if (row) rows.push(row);
    }
  }
  return rows;
}

function extractTables(markdown: string): string[] {
  // A "table" is a contiguous run of lines starting with `|`. We tolerate the
  // separator row (`|---|---|`) and don't treat it as data.
  const lines = markdown.split(/\r?\n/);
  const tables: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trimStart().startsWith("|")) {
      current.push(line);
    } else if (current.length) {
      tables.push(current.join("\n"));
      current = [];
    }
  }
  if (current.length) tables.push(current.join("\n"));
  return tables;
}

function parseRows(table: string): ParsedRow[] {
  const lines = table
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));
  if (lines.length < 2) return [];

  const header = splitRow(lines[0]!).map((c) => c.toLowerCase());
  const out: ParsedRow[] = [];

  for (const line of lines.slice(1)) {
    if (isSeparatorRow(line)) continue;
    const cells = splitRow(line);
    if (cells.length === 0) continue;
    const obj: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]!] = cells[i] ?? "";
    }
    out.push({ cells: obj, raw: line });
  }

  return out;
}

function splitRow(line: string): string[] {
  // Strip leading/trailing pipes, split on the rest, then trim each cell.
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function isSeparatorRow(line: string): boolean {
  // A separator row has only `-`, `:`, `|`, and whitespace.
  return /^\s*\|?\s*[:\-\s|]+\s*\|?\s*$/.test(line);
}

function rowToFollowUp(parsed: ParsedRow): FollowUp | null {
  const c = parsed.cells;
  const project = c["project"];
  const task = c["task"];
  if (!project || !task) return null;

  const statusText = c["status"] ?? "";
  const status = classifyStatus(statusText);
  const statusNote = stripStatusEmoji(statusText);

  return {
    follow_up_id: deterministicId(project, task, c["sent"] ?? ""),
    project,
    task,
    sent: c["sent"] ?? "",
    follow_up_by: c["follow-up by"] || c["follow up by"] || undefined,
    status,
    status_note: statusNote || undefined,
    source: c["source"] || undefined,
  };
}

function classifyStatus(text: string): FollowUpStatus {
  if (/✅|resolved|done/i.test(text)) return "resolved";
  if (/escalat|overdue/i.test(text)) return "escalated";
  return "waiting";
}

function stripStatusEmoji(text: string): string {
  return text
    .replace(/^[✅⏳⚠️❗️❌]+\s*/u, "")
    .replace(/^(Resolved|Waiting|Escalated)\b\s*[—–-]?\s*/i, "")
    .trim();
}
