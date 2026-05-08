import { join, relative } from "node:path";

import type { ResolvedVaultOptions } from "./config";
import {
  fileExists,
  fileMtime,
  listDir,
  tryReadFile,
  writeFileAtomic,
} from "./fs";
import {
  mergeFrontmatter,
  parseMarkdown,
  serializeMarkdown,
} from "./frontmatter";
import { newId } from "./ids";
import { vaultPaths } from "./paths";
import { extractFirstHeading, withoutMdExt } from "./slug";
import type { Draft, DraftFrontmatter, DraftState } from "./types";

/**
 * List every draft Smithers can see — both in-progress drafts in `Drafts/`
 * and archived drafts in `Drafts/Archived Drafts/`.
 *
 * Drafts/Originals/ is intentionally excluded from this list because those
 * are the source briefs, not drafts themselves; they're surfaced on the matching
 * draft via `original_path`.
 */
export async function listDrafts(
  opts: ResolvedVaultOptions,
): Promise<Draft[]> {
  const paths = vaultPaths(opts);
  const out: Draft[] = [];

  const inProgress = await listDir(paths.drafts);
  for (const e of inProgress) {
    if (!e.isFile || !e.name.toLowerCase().endsWith(".md")) continue;
    const draft = await readDraftFile(
      opts,
      join(paths.drafts, e.name),
      "in-progress",
    );
    if (draft) out.push(draft);
  }

  const archived = await listDir(paths.draftsArchived);
  for (const e of archived) {
    if (!e.isFile || !e.name.toLowerCase().endsWith(".md")) continue;
    const draft = await readDraftFile(
      opts,
      join(paths.draftsArchived, e.name),
      "archived",
    );
    if (draft) out.push(draft);
  }

  out.sort((a, b) => b.modified_at.localeCompare(a.modified_at));
  return out;
}

/** Read a draft by stable id. Looks in both in-progress and archived locations. */
export async function readDraft(
  opts: ResolvedVaultOptions,
  draftId: string,
): Promise<Draft | null> {
  const all = await listDrafts(opts);
  return all.find((d) => d.draft_id === draftId) ?? null;
}

export interface CreateDraftFromAiInput {
  /** Optional project to attach the draft to. */
  project_slug?: string;
  /** Display title — used for the H1 + filename slug. */
  title: string;
  /** The draft body the user starts editing. */
  body: string;
  /** Snapshot of the AI's first pass — used later to compute archive-time diffs. */
  original_body?: string;
  /** Which agent produced this — kept in frontmatter for the style-guide loop. */
  source_agent?: string;
  /** Optional subject line (preserved in frontmatter for email-style drafts). */
  subject?: string;
  /** Optional channel hint ("email" / "slack" / "zendesk" / "p2"). */
  channel?: string;
  /** Read-only context block (e.g. latest partner reply) shown above the editor. */
  context_preview?: string;
  context_preview_label?: string;
  context_preview_meta?: string;
}

export interface CreateDraftFromAiResult {
  draft_id: string;
  absolute_path: string;
  relative_path: string;
}

/**
 * Create a new draft file in `Drafts/` from AI-generated content. The
 * AI's first pass is snapshotted into frontmatter (`original_body`)
 * so archive-time diffs can later teach the style-guide what the
 * user's voice does to a generic draft.
 *
 * Filename uses a slugified title; collisions get a numeric suffix.
 */
export async function createDraftFromAi(
  opts: ResolvedVaultOptions,
  input: CreateDraftFromAiInput,
): Promise<CreateDraftFromAiResult> {
  const trimmedTitle = input.title.trim();
  if (!trimmedTitle) throw new Error("title is required");
  if (!input.body.trim()) throw new Error("body is required");

  const { mkdir } = await import("node:fs/promises");
  const paths = vaultPaths(opts);
  await mkdir(paths.drafts, { recursive: true });

  const draftId = newId();
  const fileName = await pickFreshDraftFilename(paths.drafts, trimmedTitle);
  const absolutePath = join(paths.drafts, fileName);

  const frontmatter: Record<string, unknown> = {
    draft_id: draftId,
    state: "in-progress" as DraftState,
    created_at: new Date().toISOString(),
  };
  if (input.project_slug) frontmatter["project_slug"] = input.project_slug;
  if (input.source_agent) frontmatter["source_agent"] = input.source_agent;
  if (input.original_body !== undefined) {
    frontmatter["original_body"] = input.original_body;
  }
  if (input.subject) frontmatter["subject"] = input.subject;
  if (input.channel) frontmatter["channel"] = input.channel;
  if (input.context_preview) {
    frontmatter["context_preview"] = input.context_preview;
  }
  if (input.context_preview_label) {
    frontmatter["context_preview_label"] = input.context_preview_label;
  }
  if (input.context_preview_meta) {
    frontmatter["context_preview_meta"] = input.context_preview_meta;
  }

  // Body kicks off with a friendly H1 so the listing renders a
  // recognizable title; the actual draft text follows.
  const body = `# ${trimmedTitle}\n\n${input.body}\n`;
  await writeFileAtomic(absolutePath, serializeMarkdown(frontmatter, body));

  return {
    draft_id: draftId,
    absolute_path: absolutePath,
    relative_path: relative(opts.vaultPath, absolutePath),
  };
}

async function pickFreshDraftFilename(
  draftsDir: string,
  title: string,
): Promise<string> {
  const safe = sanitizeDraftFilename(title);
  let candidate = `${safe}.md`;
  let n = 2;
  while (await tryReadFile(join(draftsDir, candidate))) {
    candidate = `${safe} (${n}).md`;
    n += 1;
  }
  return candidate;
}

function sanitizeDraftFilename(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export interface ArchiveDraftResult {
  draft_id: string;
  /** Where the archived file ended up. */
  absolute_path: string;
  relative_path: string;
}

/**
 * Move a draft from `Drafts/` to `Drafts/Archived Drafts/` and stamp
 * `state: archived` + `archived_at` into frontmatter. Idempotent: if
 * the draft is already archived, returns the existing path without
 * touching disk.
 *
 * `original_body` (when present) is preserved through the move so
 * the style-learning loop can compute diffs between the AI's first
 * pass and the user's final version after the fact.
 */
export async function archiveDraft(
  opts: ResolvedVaultOptions,
  draftId: string,
): Promise<ArchiveDraftResult> {
  const { mkdir, rename } = await import("node:fs/promises");
  const draft = await readDraft(opts, draftId);
  if (!draft) {
    throw new Error(`Draft ${draftId} not found`);
  }
  if (draft.state === "archived") {
    return {
      draft_id: draftId,
      absolute_path: draft.absolute_path,
      relative_path: draft.relative_path,
    };
  }
  const paths = vaultPaths(opts);
  await mkdir(paths.draftsArchived, { recursive: true });

  const filename = draft.absolute_path.split("/").pop() ?? `${draftId}.md`;
  const targetPath = await pickFreshDraftFilename(
    paths.draftsArchived,
    withoutMdExt(filename),
  );
  const targetAbs = join(paths.draftsArchived, targetPath);

  // Update frontmatter first (still at the in-progress path), then
  // rename. Doing the rename first would temporarily leave the file
  // with stale state if the frontmatter write later failed.
  const raw = await tryReadFile(draft.absolute_path);
  if (raw === null) {
    throw new Error(`Draft file disappeared at ${draft.absolute_path}`);
  }
  const { data, content } = parseMarkdown(raw);
  const merged = {
    ...data,
    state: "archived" as DraftState,
    archived_at: new Date().toISOString(),
  };
  await writeFileAtomic(draft.absolute_path, serializeMarkdown(merged, content));
  await rename(draft.absolute_path, targetAbs);

  return {
    draft_id: draftId,
    absolute_path: targetAbs,
    relative_path: relative(opts.vaultPath, targetAbs),
  };
}

export interface ArchivedDraftWithDiff {
  draft_id: string;
  title: string;
  source_agent?: string;
  channel?: string;
  archived_at: string;
  original_body: string;
  final_body: string;
}

/**
 * List archived drafts whose frontmatter includes an `original_body`
 * snapshot — these are the ones the style-learning agent can reason
 * about. Drafts without an original (legacy drafts predating the
 * AI flow, or hand-authored drafts) are excluded.
 *
 * Sorted newest-first by archived_at; capped at `limit` (default 25)
 * so a long tail of historical drafts doesn't blow up the prompt.
 */
export async function listArchivedDraftsWithDiffs(
  opts: ResolvedVaultOptions,
  limit = 25,
): Promise<ArchivedDraftWithDiff[]> {
  const all = await listDrafts(opts);
  const candidates: ArchivedDraftWithDiff[] = [];
  for (const d of all) {
    if (d.state !== "archived") continue;
    const raw = await tryReadFile(d.absolute_path);
    if (!raw) continue;
    const { data, content } = parseMarkdown(raw);
    const original = data["original_body"];
    if (typeof original !== "string" || !original.trim()) continue;
    const archived_at =
      typeof data["archived_at"] === "string"
        ? (data["archived_at"] as string)
        : d.modified_at;
    candidates.push({
      draft_id: d.draft_id,
      title: d.title,
      source_agent:
        typeof data["source_agent"] === "string"
          ? (data["source_agent"] as string)
          : undefined,
      channel:
        typeof data["channel"] === "string"
          ? (data["channel"] as string)
          : undefined,
      archived_at,
      original_body: original,
      final_body: content,
    });
  }
  candidates.sort((a, b) => b.archived_at.localeCompare(a.archived_at));
  return candidates.slice(0, limit);
}

export interface UpdateDraftBodyResult {
  draft_id: string;
  /** True when the on-disk content actually changed. */
  changed: boolean;
}

/**
 * Replace the body of an existing draft file. Frontmatter is preserved
 * verbatim; only the markdown content after the frontmatter changes.
 * Atomic write — partial crash mid-save can't corrupt the draft.
 */
export async function updateDraftBody(
  opts: ResolvedVaultOptions,
  draftId: string,
  newBody: string,
): Promise<UpdateDraftBodyResult> {
  const draft = await readDraft(opts, draftId);
  if (!draft) {
    throw new Error(`Draft ${draftId} not found`);
  }
  const raw = await tryReadFile(draft.absolute_path);
  if (raw === null) {
    throw new Error(`Draft file disappeared at ${draft.absolute_path}`);
  }
  const { data, content } = parseMarkdown(raw);
  if (content === newBody) {
    return { draft_id: draftId, changed: false };
  }
  await writeFileAtomic(
    draft.absolute_path,
    serializeMarkdown(data, newBody),
  );
  return { draft_id: draftId, changed: true };
}

/**
 * Ensure a draft file has a `draft_id` in its frontmatter. Generates one if
 * missing; idempotent.
 */
export async function ensureDraftId(
  opts: ResolvedVaultOptions,
  draft: Draft,
): Promise<string> {
  const raw = await tryReadFile(draft.absolute_path);
  if (!raw) return draft.draft_id;
  const { data, content } = parseMarkdown(raw);
  if (data.draft_id) return String(data.draft_id);
  const id = draft.draft_id.startsWith("local:") ? newId() : draft.draft_id;
  const merged = mergeFrontmatter(data, {
    draft_id: id,
    state: draft.state,
    project_slug: draft.project_slug,
    project_id: draft.project_id,
    created_at: draft.created_at,
  });
  await writeFileAtomic(draft.absolute_path, serializeMarkdown(merged, content));
  return id;
}

// --- internals ---

async function readDraftFile(
  opts: ResolvedVaultOptions,
  absolutePath: string,
  state: DraftState,
): Promise<Draft | null> {
  const raw = await tryReadFile(absolutePath);
  if (raw === null) return null;

  const { data, content } = parseMarkdown(raw);
  const fm = data as DraftFrontmatter;

  const fileName = absolutePath.split("/").pop() ?? "";
  const baseName = withoutMdExt(fileName);
  const heading = extractFirstHeading(content);

  const mtime = (await fileMtime(absolutePath)) ?? new Date(0).toISOString();

  const paths = vaultPaths(opts);
  const originalCandidate = join(paths.draftsOriginals, fileName);
  const archivedCandidate = join(paths.draftsArchived, fileName);

  return {
    draft_id: fm.draft_id ?? `local:${relative(opts.vaultPath, absolutePath)}`,
    project_slug: fm.project_slug,
    project_id: fm.project_id,
    state: fm.state ?? state,
    title: heading ?? baseName,
    absolute_path: absolutePath,
    relative_path: relative(opts.vaultPath, absolutePath),
    original_path: fileExists(originalCandidate) ? originalCandidate : undefined,
    archived_path:
      state === "archived"
        ? absolutePath
        : fileExists(archivedCandidate)
          ? archivedCandidate
          : undefined,
    body: content,
    modified_at: mtime,
    context_preview: fm.context_preview,
    context_preview_label: fm.context_preview_label,
    context_preview_meta: fm.context_preview_meta,
    created_at: fm.created_at,
    archived_at: fm.archived_at,
    tags: Array.isArray(fm.tags) ? fm.tags : [],
  };
}
