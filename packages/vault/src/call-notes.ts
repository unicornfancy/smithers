// Call notes are sourced from the configured transcription provider and dropped
// into `Call Notes/` by the vault watcher's downstream pipeline.

import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";

import type { ResolvedVaultOptions } from "./config";
import { parseMarkdown, serializeMarkdown } from "./frontmatter";
import {
  fileMtime,
  listMarkdownFiles,
  tryReadFile,
  writeFileAtomic,
} from "./fs";
import { vaultPaths } from "./paths";
import { slugify } from "./slug";

export interface CallNoteRef {
  absolute_path: string;
  relative_path: string;
  filename: string;
  modified_at: string;
}

export async function listCallNotes(
  opts: ResolvedVaultOptions,
): Promise<CallNoteRef[]> {
  const paths = vaultPaths(opts);
  const files = await listMarkdownFiles(paths.callNotes);
  const out: CallNoteRef[] = [];
  for (const f of files) {
    const abs = join(paths.callNotes, f);
    out.push({
      absolute_path: abs,
      relative_path: relative(opts.vaultPath, abs),
      filename: f,
      modified_at: (await fileMtime(abs)) ?? new Date(0).toISOString(),
    });
  }
  out.sort((a, b) => b.modified_at.localeCompare(a.modified_at));
  return out;
}

/**
 * Structured analysis stored alongside a saved call notes file. Mirrors
 * the analyze-call-transcript agent's output, intentionally decoupled
 * (no @smithers/agents dependency in vault) — callers convert at the
 * boundary.
 */
export interface SavedCallAnalysis {
  summary: string;
  action_items: Array<{ text: string; owner: string }>;
  follow_ups: Array<{
    task: string;
    rationale: string;
    follow_up_by?: string;
  }>;
  decisions: Array<{ text: string; context?: string }>;
  key_quotes: Array<{ speaker: string; text: string }>;
}

export interface SavedCallNote {
  /** Path to the saved file. */
  absolute_path: string;
  relative_path: string;
  /** Recording id from frontmatter — the canonical lookup key. */
  recording_id: string;
  /** Empty string for team/orphan calls that don't belong to a project. */
  project_slug: string;
  /** ISO timestamp when the call was recorded. */
  recorded_at: string;
  title: string;
  fathom_url?: string;
  /** ISO timestamp when the analysis last ran. */
  analyzed_at: string;
  /** Parsed analysis payload (round-trippable). */
  analysis: SavedCallAnalysis;
}

export interface SaveCallNotesInput {
  /** Omit (or empty string) for team/orphan calls without a project. */
  project_slug?: string;
  recording: {
    recording_id: string;
    title?: string | null;
    recorded_at?: string | null;
    url?: string | null;
  };
  analysis: SavedCallAnalysis;
  /**
   * Raw transcript body. When provided, written as a `## Transcript`
   * section at the bottom of the saved file. Required for external
   * imports (no upstream API to re-fetch from when reprocessing);
   * omitted by Fathom processing (Smithers re-fetches from Fathom
   * on demand). Stored verbatim in the body — frontmatter stays clean.
   */
  transcript?: string;
}

/**
 * Persist a call analysis to `Call Notes/<date> - <title>.md`. The
 * structured analysis lives in frontmatter (round-trippable); the
 * body is rendered markdown for easy human reading.
 *
 * Idempotent on `recording_id` — if a file with the same recording
 * already exists in Call Notes/, that file is overwritten in place
 * regardless of the new title (so re-running analysis on the same
 * recording doesn't litter the directory with sibling files).
 */
export async function saveCallNotes(
  opts: ResolvedVaultOptions,
  input: SaveCallNotesInput,
): Promise<SavedCallNote> {
  const paths = vaultPaths(opts);
  await mkdir(paths.callNotes, { recursive: true });

  const recordingId = input.recording.recording_id;
  if (!recordingId) {
    throw new Error("recording_id is required to save call notes");
  }

  const recordedAt = input.recording.recorded_at
    ? toIsoSafe(input.recording.recorded_at)
    : new Date().toISOString();
  const dateOnly = recordedAt.slice(0, 10);
  const title = (input.recording.title ?? "Untitled call").trim();

  const existing = await findCallNotesByRecordingId(opts, recordingId);
  const targetPath = existing
    ? existing.absolute_path
    : await pickFreshFilename(paths.callNotes, dateOnly, title, recordingId);

  const analyzedAt = new Date().toISOString();

  const projectSlug = input.project_slug ?? "";
  const frontmatter: Record<string, unknown> = {
    recording_id: recordingId,
    recorded_at: recordedAt,
    title,
    analyzed_at: analyzedAt,
    analysis: input.analysis,
  };
  if (projectSlug) {
    frontmatter["project_slug"] = projectSlug;
  }
  if (input.recording.url) {
    frontmatter["fathom_url"] = input.recording.url;
  }

  const body = renderCallNotesBody(
    title,
    dateOnly,
    input.analysis,
    input.recording.url,
    input.transcript,
  );
  await writeFileAtomic(targetPath, serializeMarkdown(frontmatter, body));

  return {
    absolute_path: targetPath,
    relative_path: relative(opts.vaultPath, targetPath),
    recording_id: recordingId,
    project_slug: projectSlug,
    recorded_at: recordedAt,
    title,
    fathom_url: input.recording.url ?? undefined,
    analyzed_at: analyzedAt,
    analysis: input.analysis,
  };
}

/**
 * Look up a saved call notes file by `recording_id` (frontmatter key).
 * Returns null when no file matches. Lookup scans Call Notes/ and
 * reads frontmatter of each candidate; for typical vault sizes
 * (<500 files) this is fast enough to skip a separate index.
 */
export async function findCallNotesByRecordingId(
  opts: ResolvedVaultOptions,
  recordingId: string,
): Promise<SavedCallNote | null> {
  if (!recordingId) return null;
  const paths = vaultPaths(opts);
  const files = await listMarkdownFiles(paths.callNotes);
  for (const f of files) {
    const abs = join(paths.callNotes, f);
    const raw = await tryReadFile(abs);
    if (!raw) continue;
    const { data } = parseMarkdown(raw);
    if (data["recording_id"] !== recordingId) continue;
    const parsed = parseSavedFrontmatter(data, abs, opts.vaultPath);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Lightweight slice of a saved call note keyed for the weekly-update
 * facts collector. Returns frontmatter-only (recording_id, project,
 * recorded_at, title, summary) — no analysis structure parsed. Same
 * file-scan cost as findCallNotesByRecordingId, capped per call by
 * the date filter.
 */
export interface RecentCallSlice {
  recording_id: string;
  project_slug: string;
  recorded_at: string;
  title: string;
  summary?: string;
}

export async function listRecentCallSlices(
  opts: ResolvedVaultOptions,
  range: { since: string; until: string },
): Promise<RecentCallSlice[]> {
  const paths = vaultPaths(opts);
  const files = await listMarkdownFiles(paths.callNotes);
  const out: RecentCallSlice[] = [];
  for (const f of files) {
    const abs = join(paths.callNotes, f);
    const raw = await tryReadFile(abs);
    if (!raw) continue;
    const { data } = parseMarkdown(raw);
    const recordedAt =
      typeof data["recorded_at"] === "string" ? data["recorded_at"] : null;
    if (!recordedAt || recordedAt < range.since || recordedAt >= range.until) {
      continue;
    }
    const analysis = data["analysis"] as { summary?: string } | undefined;
    out.push({
      recording_id: typeof data["recording_id"] === "string" ? data["recording_id"] : "",
      project_slug: typeof data["project_slug"] === "string" ? data["project_slug"] : "",
      recorded_at: recordedAt,
      title: typeof data["title"] === "string" ? data["title"] : f,
      summary: typeof analysis?.summary === "string" ? analysis.summary : undefined,
    });
  }
  out.sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  return out;
}

/**
 * All-time index of saved call notes whose frontmatter `project_slug`
 * matches the given slug. Returns frontmatter-only slices (recording id,
 * recorded_at, title, summary) sorted newest first — same shape as
 * `listRecentCallSlices` but un-windowed by date.
 *
 * Workbench uses this so processed calls persist on the project page
 * regardless of whether the underlying Fathom recording still appears
 * in the transcription adapter's recent list.
 */
export async function listCallNotesForProject(
  opts: ResolvedVaultOptions,
  projectSlug: string,
): Promise<RecentCallSlice[]> {
  if (!projectSlug) return [];
  const paths = vaultPaths(opts);
  const files = await listMarkdownFiles(paths.callNotes);
  const out: RecentCallSlice[] = [];
  for (const f of files) {
    const abs = join(paths.callNotes, f);
    const raw = await tryReadFile(abs);
    if (!raw) continue;
    const { data } = parseMarkdown(raw);
    const slug =
      typeof data["project_slug"] === "string" ? data["project_slug"] : "";
    if (slug !== projectSlug) continue;
    const recordedAt =
      typeof data["recorded_at"] === "string" ? data["recorded_at"] : null;
    if (!recordedAt) continue;
    const analysis = data["analysis"] as { summary?: string } | undefined;
    out.push({
      recording_id:
        typeof data["recording_id"] === "string" ? data["recording_id"] : "",
      project_slug: slug,
      recorded_at: recordedAt,
      title: typeof data["title"] === "string" ? data["title"] : f,
      summary:
        typeof analysis?.summary === "string" ? analysis.summary : undefined,
    });
  }
  out.sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  return out;
}

// --- internals ---

function parseSavedFrontmatter(
  data: Record<string, unknown>,
  abs: string,
  vaultPath: string,
): SavedCallNote | null {
  const recording_id = typeof data["recording_id"] === "string" ? data["recording_id"] : null;
  // project_slug is optional now — team-call notes (no project association)
  // omit it from frontmatter. Default to empty string when absent.
  const project_slug = typeof data["project_slug"] === "string" ? data["project_slug"] : "";
  const recorded_at = typeof data["recorded_at"] === "string" ? data["recorded_at"] : null;
  const title = typeof data["title"] === "string" ? data["title"] : null;
  const analyzed_at = typeof data["analyzed_at"] === "string" ? data["analyzed_at"] : null;
  if (!recording_id || !recorded_at || !title || !analyzed_at) {
    return null;
  }
  const fathom_url = typeof data["fathom_url"] === "string" ? data["fathom_url"] : undefined;
  const analysis = data["analysis"];
  if (!analysis || typeof analysis !== "object") return null;
  const a = analysis as Record<string, unknown>;
  const summary = typeof a["summary"] === "string" ? a["summary"] : "";
  const action_items = Array.isArray(a["action_items"])
    ? (a["action_items"] as unknown[])
        .map((it) => coerceActionItem(it))
        .filter((it): it is { text: string; owner: string } => it !== null)
    : [];
  const follow_ups = Array.isArray(a["follow_ups"])
    ? (a["follow_ups"] as unknown[])
        .map((it) => coerceFollowUp(it))
        .filter(
          (it): it is { task: string; rationale: string; follow_up_by?: string } =>
            it !== null,
        )
    : [];
  const decisions = Array.isArray(a["decisions"])
    ? (a["decisions"] as unknown[])
        .map((it) => coerceDecision(it))
        .filter((it): it is { text: string; context?: string } => it !== null)
    : [];
  const key_quotes = Array.isArray(a["key_quotes"])
    ? (a["key_quotes"] as unknown[])
        .map((it) => coerceQuote(it))
        .filter((it): it is { speaker: string; text: string } => it !== null)
    : [];

  return {
    absolute_path: abs,
    relative_path: relative(vaultPath, abs),
    recording_id,
    project_slug,
    recorded_at,
    title,
    fathom_url,
    analyzed_at,
    analysis: { summary, action_items, follow_ups, decisions, key_quotes },
  };
}

function coerceActionItem(it: unknown): { text: string; owner: string } | null {
  if (!it || typeof it !== "object") return null;
  const o = it as Record<string, unknown>;
  const text = typeof o["text"] === "string" ? o["text"] : null;
  const owner = typeof o["owner"] === "string" ? o["owner"] : "unknown";
  return text ? { text, owner } : null;
}
function coerceFollowUp(
  it: unknown,
): { task: string; rationale: string; follow_up_by?: string } | null {
  if (!it || typeof it !== "object") return null;
  const o = it as Record<string, unknown>;
  const task = typeof o["task"] === "string" ? o["task"] : null;
  const rationale = typeof o["rationale"] === "string" ? o["rationale"] : "";
  if (!task) return null;
  const follow_up_by =
    typeof o["follow_up_by"] === "string" && o["follow_up_by"]
      ? (o["follow_up_by"] as string)
      : undefined;
  return { task, rationale, follow_up_by };
}
function coerceDecision(it: unknown): { text: string; context?: string } | null {
  if (!it || typeof it !== "object") return null;
  const o = it as Record<string, unknown>;
  const text = typeof o["text"] === "string" ? o["text"] : null;
  const context =
    typeof o["context"] === "string" && o["context"] ? (o["context"] as string) : undefined;
  return text ? { text, context } : null;
}
function coerceQuote(it: unknown): { speaker: string; text: string } | null {
  if (!it || typeof it !== "object") return null;
  const o = it as Record<string, unknown>;
  const speaker = typeof o["speaker"] === "string" ? o["speaker"] : null;
  const text = typeof o["text"] === "string" ? o["text"] : null;
  return speaker && text ? { speaker, text } : null;
}

/**
 * Pick a filename `<date> - <title>.md` (matching the existing vault's
 * convention). Suffix with " (2)", " (3)" etc. on collision so two
 * unrelated calls on the same day with the same title don't overwrite
 * each other. recordingId is used to disambiguate when no other signal
 * is available.
 */
async function pickFreshFilename(
  dirAbs: string,
  date: string,
  title: string,
  recordingId: string,
): Promise<string> {
  const cleanTitle = sanitizeTitleForFilename(title);
  const baseName = cleanTitle ? `${date} - ${cleanTitle}` : `${date} - ${recordingId}`;
  let candidate = `${baseName}.md`;
  let n = 2;
  while (await tryReadFile(join(dirAbs, candidate))) {
    candidate = `${baseName} (${n}).md`;
    n += 1;
  }
  return join(dirAbs, candidate);
}

function sanitizeTitleForFilename(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function toIsoSafe(value: string): string {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    return new Date().toISOString();
  }
  return new Date(ts).toISOString();
}

function renderCallNotesBody(
  title: string,
  date: string,
  a: SavedCallAnalysis,
  url: string | null | undefined,
  transcript: string | undefined,
): string {
  const lines: string[] = [];
  lines.push(`# ${title} — ${date}`);
  if (url) {
    lines.push("");
    lines.push(`[Open in Fathom](${url})`);
  }

  if (a.summary) {
    lines.push("", "## Summary", "", a.summary);
  }
  if (a.action_items.length > 0) {
    lines.push("", "## Action items", "");
    for (const it of a.action_items) {
      const owner = it.owner && it.owner !== "unknown" ? ` _(${it.owner})_` : "";
      lines.push(`- [ ] ${it.text}${owner}`);
    }
  }
  if (a.follow_ups.length > 0) {
    lines.push("", "## Follow-ups", "");
    for (const f of a.follow_ups) {
      const due = f.follow_up_by ? ` — due ${f.follow_up_by}` : "";
      lines.push(`- ${f.task}${due}`);
      if (f.rationale) {
        lines.push(`  *${f.rationale}*`);
      }
    }
  }
  if (a.decisions.length > 0) {
    lines.push("", "## Decisions", "");
    for (const d of a.decisions) {
      lines.push(`- ${d.text}`);
      if (d.context) {
        lines.push(`  *${d.context}*`);
      }
    }
  }
  if (a.key_quotes.length > 0) {
    lines.push("", "## Key quotes", "");
    for (const q of a.key_quotes) {
      lines.push(`> ${q.text}`);
      lines.push(`> — ${q.speaker}`);
      lines.push("");
    }
  }
  if (transcript && transcript.trim()) {
    lines.push("", "## Transcript", "");
    lines.push(transcript.trim());
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Read back the verbatim transcript stashed in a saved call-notes
 * file's `## Transcript` section. Returns null when no transcript
 * was stored (Fathom processing flow doesn't persist them — those
 * re-fetch from the upstream API on reprocess).
 *
 * Match is `^## Transcript$` then capture until the next H2 (`## `)
 * or EOF; tolerates whitespace and trailing blank lines.
 */
export async function readCallNotesTranscriptByRecordingId(
  opts: ResolvedVaultOptions,
  recordingId: string,
): Promise<string | null> {
  if (!recordingId) return null;
  const existing = await findCallNotesByRecordingId(opts, recordingId);
  if (!existing) return null;
  const raw = await tryReadFile(existing.absolute_path);
  if (!raw) return null;
  const { content } = parseMarkdown(raw);
  const match = /\n##\s+Transcript\s*\n([\s\S]*?)(?=\n##\s+|\s*$)/i.exec(
    `\n${content}`,
  );
  const captured = match?.[1]?.trim();
  return captured && captured.length > 0 ? captured : null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AppendChatToCallNotesResult {
  /** true when the file was modified; false when no file was found. */
  changed: boolean;
}

/**
 * Append (or replace) a `## Chat` section to an existing Call Notes file
 * identified by recording_id. The section is formatted with bold speaker
 * labels so it renders cleanly in Obsidian. If the file already has a
 * `## Chat` section, it is replaced in full — so saving the same
 * conversation twice is idempotent.
 *
 * Returns `{ changed: false }` when no file exists for the recording_id.
 */
export async function appendChatToCallNotes(
  opts: ResolvedVaultOptions,
  recordingId: string,
  messages: ChatMessage[],
): Promise<AppendChatToCallNotesResult> {
  if (!recordingId) return { changed: false };
  const existing = await findCallNotesByRecordingId(opts, recordingId);
  if (!existing) return { changed: false };

  const raw = await tryReadFile(existing.absolute_path);
  if (!raw) return { changed: false };

  const chatSection = renderChatSection(messages);

  // Replace existing ## Chat block if present, otherwise append.
  const CHAT_HEADING = "\n## Chat";
  const idx = raw.indexOf(CHAT_HEADING);
  let updated: string;
  if (idx !== -1) {
    // Find the next ## heading after ## Chat, if any, to know the slice boundary.
    const afterHeading = idx + CHAT_HEADING.length;
    const nextHeading = raw.indexOf("\n## ", afterHeading);
    if (nextHeading !== -1) {
      updated = raw.slice(0, idx) + chatSection + "\n" + raw.slice(nextHeading);
    } else {
      updated = raw.slice(0, idx) + chatSection;
    }
  } else {
    // Append after trimming trailing newlines.
    updated = raw.trimEnd() + "\n" + chatSection;
  }

  await writeFileAtomic(existing.absolute_path, updated);
  return { changed: true };
}

function renderChatSection(messages: ChatMessage[]): string {
  const lines: string[] = ["", "## Chat", ""];
  for (const msg of messages) {
    const label = msg.role === "user" ? "**You:**" : "**Smithers:**";
    lines.push(`${label} ${msg.content.trim()}`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Slug helper kept inside this module so callers can derive the same
 * filename basis if they want to render hyperlinks elsewhere.
 */
export function callNotesFilenameBase(
  date: string,
  title: string,
  recordingId: string,
): string {
  const cleanTitle = sanitizeTitleForFilename(title);
  return cleanTitle
    ? `${date} - ${slugify(cleanTitle)}`
    : `${date} - ${recordingId}`;
}
