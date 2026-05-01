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
    created_at: fm.created_at,
    archived_at: fm.archived_at,
    tags: Array.isArray(fm.tags) ? fm.tags : [],
  };
}
