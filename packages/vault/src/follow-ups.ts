import type { ResolvedVaultOptions } from "./config";
import { tryReadFile } from "./fs";
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
