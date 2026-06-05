import { join } from "node:path";

import type { ResolvedVaultOptions } from "./config";
import { listDir, tryReadFile } from "./fs";
import { parseMarkdown } from "./frontmatter";

function hiveMindPartnersDir(opts: ResolvedVaultOptions): string | null {
  if (!opts.hiveMindPath) return null;
  return join(opts.hiveMindPath, "knowledge", "partners");
}

function hiveMindSkillsDir(opts: ResolvedVaultOptions): string | null {
  if (!opts.hiveMindPath) return null;
  return join(opts.hiveMindPath, ".claude", "skills");
}

export interface HiveMindSkill {
  /** Folder name under .claude/skills/ — also the invocation slash-command. */
  slug: string;
  /** From SKILL.md frontmatter `name`; falls back to slug. */
  name: string;
  /** From frontmatter `description`. */
  description: string;
  /** From frontmatter `allowed-tools` (split on comma). */
  allowed_tools: string[];
  /** From frontmatter `user-invocable`. Defaults to true when absent. */
  user_invocable: boolean;
  /**
   * From frontmatter `dependencies` — list of HM-root-relative file
   * paths the skill expects to read at runtime (templates, knowledge
   * files, reference briefs). Smithers loads these alongside SKILL.md
   * when running the skill from the workbench. Empty array when the
   * skill declares no deps or the field is absent.
   */
  dependencies: string[];
  /** Absolute path to the skill folder (the `.claude/skills/<slug>/` dir). */
  location: string;
  /** Absolute path to the SKILL.md file. */
  source_path: string;
}

export interface HiveMindSkillContent {
  /** Skill metadata from the SKILL.md frontmatter. */
  skill: HiveMindSkill;
  /**
   * Body of the SKILL.md (frontmatter stripped). Use this as the
   * system prompt when running the skill from Smithers.
   */
  system_prompt: string;
  /**
   * Map of `<hm-relative-path>` → file content for the supporting
   * files this skill declared under its `dependencies` frontmatter.
   * Keys are relative to the Hive-Mind root. Missing files are
   * silently omitted (no exception).
   */
  files: Record<string, string>;
}

/**
 * Load a skill's full content from the Hive Mind clone: the SKILL.md
 * body (as a system prompt) plus every file listed in the skill's
 * `dependencies` frontmatter. Returns `null` when HM isn't configured
 * or the skill doesn't exist.
 *
 * Smithers runs the skill as-is — the SKILL.md is the source of
 * truth for what the brief looks like. If the prompt evolves in HM,
 * Smithers picks up the change on the next call.
 */
export async function getHiveMindSkillContent(
  opts: ResolvedVaultOptions,
  slug: string,
): Promise<HiveMindSkillContent | null> {
  const all = await listHiveMindSkills(opts);
  const skill = all.find((s) => s.slug === slug);
  if (!skill) return null;
  const raw = await tryReadFile(skill.source_path);
  if (!raw) return null;
  const parsed = parseMarkdown(raw);

  const files: Record<string, string> = {};
  if (opts.hiveMindPath) {
    for (const rel of skill.dependencies) {
      const content = await tryReadFile(join(opts.hiveMindPath, rel));
      if (content !== null) files[rel] = content;
    }
  }

  return {
    skill,
    system_prompt: parsed.content.trim(),
    files,
  };
}

/**
 * List every `.claude/skills/<slug>/SKILL.md` in the configured Hive
 * Mind clone, parsing each one's frontmatter. Returns `[]` when
 * Hive Mind isn't configured or the skills dir doesn't exist.
 */
export async function listHiveMindSkills(
  opts: ResolvedVaultOptions,
): Promise<HiveMindSkill[]> {
  const dir = hiveMindSkillsDir(opts);
  if (!dir) return [];
  const entries = await listDir(dir);
  const skills: HiveMindSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const slug = entry.name;
    const folder = join(dir, slug);
    const sourcePath = join(folder, "SKILL.md");
    const raw = await tryReadFile(sourcePath);
    if (!raw) continue;
    const { data } = parseMarkdown(raw);
    const allowedTools = asString(data["allowed-tools"]);
    const userInvocable =
      data["user-invocable"] === undefined ? true : Boolean(data["user-invocable"]);
    // `dependencies` is an optional YAML list — HM-root-relative paths the
    // skill reads at runtime (templates, knowledge files, reference briefs).
    // Smithers loads these alongside SKILL.md when running the skill.
    const dependencies = Array.isArray(data.dependencies)
      ? data.dependencies
          .map((d) => (typeof d === "string" ? d.trim() : ""))
          .filter(Boolean)
      : [];
    skills.push({
      slug,
      name: asString(data.name) ?? slug,
      description: asString(data.description) ?? "",
      allowed_tools: allowedTools
        ? allowedTools.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      user_invocable: userInvocable,
      dependencies,
      location: folder,
      source_path: sourcePath,
    });
  }
  skills.sort((a, b) => a.slug.localeCompare(b.slug));
  return skills;
}

export interface HiveMindPartnerContact {
  /** Required — the email is the search/match key. */
  email: string;
  /** Display name; falls back to the email local-part when absent. */
  name?: string;
  /** Free-form role label ("Engineering Lead", "Founder"). */
  role?: string;
}

export interface HiveMindPartner {
  title?: string;
  owner?: string;
  nda?: boolean;
  tags?: string[];
  description?: string;
  /** From frontmatter `domain_registrar` (added 2026-05-28 for brief inputs). */
  domain_registrar?: string;
  /** From frontmatter `dns_provider` (added 2026-05-28 for brief inputs). */
  dns_provider?: string;
  /**
   * Partner contacts from the `contacts:` frontmatter (added 2026-06-05).
   * Powers Smithers' suggested-tickets surface — Zendesk searches fan out
   * across these emails to catch unattached threads from partner senders.
   * Always normalized to a clean array; bad entries are silently dropped.
   */
  contacts?: HiveMindPartnerContact[];
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
    domain_registrar: asString(data.domain_registrar),
    dns_provider: asString(data.dns_provider),
    contacts: asContactArray(data.contacts),
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
  /** From frontmatter `discovery_doc_url` (added 2026-05-28 for brief inputs). */
  discovery_doc_url?: string;
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
    discovery_doc_url: asString(data.discovery_doc_url),
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
  /** Absolute path of the file actually read — used by the workbench
   * to build an "Edit brief" link that opens the right file. */
  source_path: string;
}

/**
 * Read the project brief for a given partner/project. Tries three paths
 * in order so older / non-conforming briefs still surface:
 *
 *   1. `briefs/project-brief.md` — the canonical schema documented in
 *      Hive-Mind's CONTRIBUTING.
 *   2. `info.md`'s `brief_path` frontmatter (relative to the project
 *      folder), when set. Lets a partner-team point at a brief that
 *      doesn't sit at the canonical path.
 *   3. `brief.md` at the project root — the de-facto location for
 *      briefs created before the canonical path was nailed down.
 *
 * The brief's own google_doc_url frontmatter is read regardless of
 * which file backed the content.
 */
export async function getHiveMindBrief(
  opts: ResolvedVaultOptions,
  partnerSlug: string,
  projectSlug: string,
): Promise<HiveMindBrief | null> {
  const base = hiveMindPartnersDir(opts);
  if (!base) return null;
  const projectRoot = join(base, partnerSlug, projectSlug);

  // 1. Canonical path.
  const canonical = join(projectRoot, "briefs", "project-brief.md");
  let raw = await tryReadFile(canonical);
  let sourcePath = canonical;

  // 2. info.md frontmatter override.
  if (!raw) {
    const infoRaw = await tryReadFile(join(projectRoot, "info.md"));
    if (infoRaw) {
      const infoBriefPath = asString(parseMarkdown(infoRaw).data.brief_path);
      if (infoBriefPath) {
        // Treat the override as project-relative for safety; an
        // absolute path would let a stray frontmatter value read
        // arbitrary files. Strip leading "./" too.
        const cleaned = infoBriefPath.replace(/^\.\/+/, "");
        if (!cleaned.startsWith("/") && !cleaned.includes("..")) {
          const overridePath = join(projectRoot, cleaned);
          const overrideRaw = await tryReadFile(overridePath);
          if (overrideRaw) {
            raw = overrideRaw;
            sourcePath = overridePath;
          }
        }
      }
    }
  }

  // 3. Root brief.md fallback.
  if (!raw) {
    const rootPath = join(projectRoot, "brief.md");
    const rootRaw = await tryReadFile(rootPath);
    if (rootRaw) {
      raw = rootRaw;
      sourcePath = rootPath;
    }
  }

  if (!raw) return null;

  const { data, content } = parseMarkdown(raw);
  return {
    google_doc_url: asString(data.google_doc_url),
    body: content.trim(),
    source_path: sourcePath,
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

function asContactArray(v: unknown): HiveMindPartnerContact[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: HiveMindPartnerContact[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const email = asString(obj.email);
    if (!email) continue;
    out.push({
      email,
      name: asString(obj.name),
      role: asString(obj.role),
    });
  }
  return out.length ? out : undefined;
}
