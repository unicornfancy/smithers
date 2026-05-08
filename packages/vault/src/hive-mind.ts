import { join } from "node:path";

import type { ResolvedVaultOptions } from "./config";
import { listDir, tryReadFile } from "./fs";
import { parseMarkdown } from "./frontmatter";

function hiveMindPartnersDir(opts: ResolvedVaultOptions): string | null {
  if (!opts.hiveMindPath) return null;
  return join(opts.hiveMindPath, "knowledge", "partners");
}

export interface HiveMindPartner {
  title?: string;
  owner?: string;
  nda?: boolean;
  tags?: string[];
  description?: string;
  body: string;
}

/** Read partner-knowledge.md for a given partner slug. Returns null if hiveMindPath is not configured or the file doesn't exist. */
export async function getHiveMindPartner(
  opts: ResolvedVaultOptions,
  partnerSlug: string,
): Promise<HiveMindPartner | null> {
  const base = hiveMindPartnersDir(opts);
  if (!base) return null;

  const filePath = join(base, partnerSlug, "partner-knowledge.md");
  const raw = await tryReadFile(filePath);
  if (!raw) return null;

  const { data, content } = parseMarkdown(raw);
  return {
    title: asString(data.title),
    owner: asString(data.owner),
    nda: asBool(data.nda),
    tags: asStringArray(data.tags),
    description: asString(data.description),
    body: content.trim(),
  };
}

export interface HiveMindProject {
  title?: string;
  status?: string;
  priority?: string;
  owner?: string;
  platform?: string;
  description?: string;
  body: string;
}

/** Read info.md for a given partner/project slug pair. Returns null if not configured or not found. */
export async function getHiveMindProject(
  opts: ResolvedVaultOptions,
  partnerSlug: string,
  projectSlug: string,
): Promise<HiveMindProject | null> {
  const base = hiveMindPartnersDir(opts);
  if (!base) return null;

  const filePath = join(base, partnerSlug, projectSlug, "info.md");
  const raw = await tryReadFile(filePath);
  if (!raw) return null;

  const { data, content } = parseMarkdown(raw);
  return {
    title: asString(data.title),
    status: asString(data.status),
    priority: asString(data.priority),
    owner: asString(data.owner),
    platform: asString(data.platform),
    description: asString(data.description),
    body: content.trim(),
  };
}

/** Read notes.md for a given partner/project slug pair. Returns null if not configured or not found. */
export async function getHiveMindNotes(
  opts: ResolvedVaultOptions,
  partnerSlug: string,
  projectSlug: string,
): Promise<string | null> {
  const base = hiveMindPartnersDir(opts);
  if (!base) return null;

  const filePath = join(base, partnerSlug, projectSlug, "notes.md");
  const raw = await tryReadFile(filePath);
  if (!raw) return null;

  const { content } = parseMarkdown(raw);
  return content.trim();
}

export interface HiveMindCallTranscript {
  filename: string;
  frontmatter: {
    title?: string;
    date?: string;
    recording_url?: string;
    transcription_service?: string;
  };
  body: string;
}

/**
 * List all .md files in the call-transcripts/ subdirectory for a project.
 * Returns [] if hiveMindPath is not configured or the directory doesn't exist.
 * Sorted by date descending (files without dates sort last).
 */
export async function getHiveMindCallTranscripts(
  opts: ResolvedVaultOptions,
  partnerSlug: string,
  projectSlug: string,
): Promise<HiveMindCallTranscript[]> {
  const base = hiveMindPartnersDir(opts);
  if (!base) return [];

  const dir = join(base, partnerSlug, projectSlug, "call-transcripts");
  const entries = await listDir(dir);
  const mdFiles = entries.filter((e) => e.isFile && e.name.toLowerCase().endsWith(".md"));

  const results: HiveMindCallTranscript[] = [];
  for (const entry of mdFiles) {
    const raw = await tryReadFile(join(dir, entry.name));
    if (!raw) continue;
    const { data, content } = parseMarkdown(raw);
    results.push({
      filename: entry.name,
      frontmatter: {
        title: asString(data.title),
        date: asString(data.date),
        recording_url: asString(data.recording_url),
        transcription_service: asString(data.transcription_service),
      },
      body: content.trim(),
    });
  }

  results.sort((a, b) => {
    const da = a.frontmatter.date ?? "";
    const db = b.frontmatter.date ?? "";
    return db.localeCompare(da);
  });

  return results;
}

export interface HiveMindDraft {
  filename: string;
  frontmatter: {
    title?: string;
    date?: string;
    type?: string;
    status?: string;
  };
  body: string;
}

/**
 * List all .md files in the drafts/ subdirectory for a project.
 * Returns [] if hiveMindPath is not configured or the directory doesn't exist.
 * Sorted by date descending (files without dates sort last).
 */
export async function getHiveMindDrafts(
  opts: ResolvedVaultOptions,
  partnerSlug: string,
  projectSlug: string,
): Promise<HiveMindDraft[]> {
  const base = hiveMindPartnersDir(opts);
  if (!base) return [];

  const dir = join(base, partnerSlug, projectSlug, "drafts");
  const entries = await listDir(dir);
  const mdFiles = entries.filter((e) => e.isFile && e.name.toLowerCase().endsWith(".md"));

  const results: HiveMindDraft[] = [];
  for (const entry of mdFiles) {
    const raw = await tryReadFile(join(dir, entry.name));
    if (!raw) continue;
    const { data, content } = parseMarkdown(raw);
    results.push({
      filename: entry.name,
      frontmatter: {
        title: asString(data.title),
        date: asString(data.date),
        type: asString(data.type),
        status: asString(data.status),
      },
      body: content.trim(),
    });
  }

  results.sort((a, b) => {
    const da = a.frontmatter.date ?? "";
    const db = b.frontmatter.date ?? "";
    return db.localeCompare(da);
  });

  return results;
}

// ---- Zendesk ----

export interface HiveMindZendeskTicket {
  ticket_id: number;
  subject: string;
  status: string;
  url: string;
}

export interface HiveMindZendeskData {
  search_terms: string[];
  tickets: HiveMindZendeskTicket[];
  last_refreshed: string | null;
}

/**
 * Read zendesk.md for a given partner/project. Returns null if not configured or file absent.
 *
 * Format:
 *   ---
 *   search_terms: [...]
 *   last_refreshed: YYYY-MM-DD
 *   ---
 *   | ticket_id | subject | status | url |
 *   | ...       | ...     | ...    | ... |
 */
export async function getHiveMindZendesk(
  opts: ResolvedVaultOptions,
  partnerSlug: string,
  projectSlug: string,
): Promise<HiveMindZendeskData | null> {
  const base = hiveMindPartnersDir(opts);
  if (!base) return null;

  const filePath = join(base, partnerSlug, projectSlug, "zendesk.md");
  const raw = await tryReadFile(filePath);
  if (!raw) return null;

  const { data, content } = parseMarkdown(raw);

  const searchTerms = asStringArray(data.search_terms) ?? [];
  const lastRefreshed = asString(data.last_refreshed) ?? null;

  const tickets: HiveMindZendeskTicket[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trimStart().startsWith("|")) continue;
    if (/^\s*\|[\s\-:]+\|/.test(line)) continue; // separator row
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    const idRaw = cells[0] ?? "";
    const id = parseInt(idRaw, 10);
    if (isNaN(id)) continue;
    tickets.push({
      ticket_id: id,
      subject: cells[1] ?? "",
      status: cells[2] ?? "",
      url: cells[3] ?? "",
    });
  }

  // skip header row (ticket_id cell is not a number)
  return { search_terms: searchTerms, tickets, last_refreshed: lastRefreshed };
}

// ---- Pinned context ----

export type HiveMindPinnedContextType =
  | "slack-thread"
  | "slack-message"
  | "github-issue-comment"
  | "call-transcript"
  | "zendesk-ticket"
  | "linear-issue"
  | "linear-project";

export interface HiveMindPinnedContextRow {
  type: HiveMindPinnedContextType;
  ref: string;
  label: string;
  added: string;
}

export interface HiveMindPinnedContextData {
  rows: HiveMindPinnedContextRow[];
  updated: string | null;
}

const PINNED_CONTEXT_TYPES: ReadonlySet<HiveMindPinnedContextType> = new Set([
  "slack-thread",
  "slack-message",
  "github-issue-comment",
  "call-transcript",
  "zendesk-ticket",
  "linear-issue",
  "linear-project",
]);

/**
 * Read pinned-context.md for a given partner/project. Returns null if
 * the file is absent or Hive-Mind is not configured. Rows whose `type`
 * isn't a known value are dropped silently — the CI validation in the
 * Hive-Mind repo gates this at write time, so reaching the runtime with
 * a bad type means someone hand-edited a file outside the validated path.
 *
 * Format (from Hive-Mind schema):
 *   ---
 *   title: "..."
 *   partner: <slug>
 *   project: <slug>
 *   updated: YYYY-MM-DD
 *   ---
 *   | type | ref | label | added |
 *   | :-- | :-- | :-- | :-- |
 *   | ... | ... | ... | ... |
 */
export async function getHiveMindPinnedContext(
  opts: ResolvedVaultOptions,
  partnerSlug: string,
  projectSlug: string,
): Promise<HiveMindPinnedContextData | null> {
  const base = hiveMindPartnersDir(opts);
  if (!base) return null;

  const filePath = join(base, partnerSlug, projectSlug, "pinned-context.md");
  const raw = await tryReadFile(filePath);
  if (!raw) return null;

  const { data, content } = parseMarkdown(raw);
  const updated = asString(data.updated) ?? null;

  const rows: HiveMindPinnedContextRow[] = [];
  let inComment = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    // Skip multi-line HTML comments — the template uses them to fence
    // an example row that should not be parsed as data.
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.startsWith("<!--") && !line.includes("-->")) {
      inComment = true;
      continue;
    }
    if (line.startsWith("<!--") && line.includes("-->")) continue;
    if (!line.startsWith("|")) continue;
    if (/^\|[\s\-:|]+\|?$/.test(line)) continue; // separator row
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    const type = cells[0] ?? "";
    if (!PINNED_CONTEXT_TYPES.has(type as HiveMindPinnedContextType)) continue;
    rows.push({
      type: type as HiveMindPinnedContextType,
      ref: cells[1] ?? "",
      label: cells[2] ?? "",
      added: cells[3] ?? "",
    });
  }

  return { rows, updated };
}

/**
 * Render a pinned-context.md file body from a row array. Used by the
 * Smithers write path before pushing to Hive-Mind via the MCP
 * `write-project-file` tool.
 */
export function serializeHiveMindPinnedContext(args: {
  partnerSlug: string;
  projectSlug: string;
  projectTitle: string;
  rows: HiveMindPinnedContextRow[];
  updated: string;
}): string {
  const fm = [
    "---",
    `title: ${JSON.stringify(`${args.projectTitle} — Pinned Context`)}`,
    `partner: ${args.partnerSlug}`,
    `project: ${args.projectSlug}`,
    `updated: ${args.updated}`,
    "---",
  ].join("\n");
  const header = "| type | ref | label | added |";
  const sep = "| :-- | :-- | :-- | :-- |";
  const dataRows = args.rows.map((r) => {
    const label = r.label.replace(/\|/g, "\\|");
    const ref = r.ref.replace(/\|/g, "\\|");
    return `| ${r.type} | ${ref} | ${label} | ${r.added} |`;
  });
  return [fm, "", "## Pinned Items", "", header, sep, ...dataRows, ""].join("\n");
}

// ---- Follow-ups ----

export interface FollowUpRow {
  id: string;
  task: string;
  sent_to: string;
  sent_date: string;
  follow_by: string;
  source_type: string;
  source_ref: string;
  status: string;
}

export interface HiveMindFollowUpsData {
  active: FollowUpRow[];
  resolved: FollowUpRow[];
}

/**
 * Read follow-ups.md for a given partner/project. Returns null if not configured or file absent.
 *
 * Format: markdown pipe table with columns:
 *   id | task | sent_to | sent_date | follow_by | source_type | source_ref | status
 */
export async function getHiveMindFollowUps(
  opts: ResolvedVaultOptions,
  partnerSlug: string,
  projectSlug: string,
): Promise<HiveMindFollowUpsData | null> {
  const base = hiveMindPartnersDir(opts);
  if (!base) return null;

  const filePath = join(base, partnerSlug, projectSlug, "follow-ups.md");
  const raw = await tryReadFile(filePath);
  if (!raw) return null;

  const active: FollowUpRow[] = [];
  const resolved: FollowUpRow[] = [];

  let header: string[] | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trimStart().startsWith("|")) continue;
    if (/^\s*\|[\s\-:]+\|/.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim().toLowerCase());
    if (cells.includes("id") && cells.includes("task")) {
      header = cells;
      continue;
    }
    if (!header) continue;
    const raw_cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    const get = (name: string) => raw_cells[header!.indexOf(name)] ?? "";
    const row: FollowUpRow = {
      id: get("id"),
      task: get("task"),
      sent_to: get("sent_to"),
      sent_date: get("sent_date"),
      follow_by: get("follow_by"),
      source_type: get("source_type"),
      source_ref: get("source_ref"),
      status: get("status"),
    };
    if (!row.id || !row.task) continue;
    if (row.status.toLowerCase().includes("resolved") || row.status.startsWith("✅")) {
      resolved.push(row);
    } else {
      active.push(row);
    }
  }

  return { active, resolved };
}

// ---- Brief ----

export interface HiveMindBrief {
  google_doc_url?: string;
  body: string;
}

/**
 * Read briefs/project-brief.md for a given partner/project. Returns null if not configured or file absent.
 */
export async function getHiveMindBrief(
  opts: ResolvedVaultOptions,
  partnerSlug: string,
  projectSlug: string,
): Promise<HiveMindBrief | null> {
  const base = hiveMindPartnersDir(opts);
  if (!base) return null;

  const filePath = join(base, partnerSlug, projectSlug, "briefs", "project-brief.md");
  const raw = await tryReadFile(filePath);
  if (!raw) return null;

  const { data, content } = parseMarkdown(raw);
  return {
    google_doc_url: asString(data.google_doc_url),
    body: content.trim(),
  };
}

// --- helpers ---

function asString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function asBool(v: unknown): boolean | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  return undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.map((x) => String(x).trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}
