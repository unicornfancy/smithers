"use server";

import { revalidatePath } from "next/cache";

import { getVault } from "@/lib/server/vault";

/**
 * Replace a draft's body. Frontmatter is preserved verbatim — only the
 * markdown content after the YAML block is rewritten. Atomic.
 */
export async function updateDraftBodyAction(
  draftId: string,
  body: string,
): Promise<{ changed: boolean }> {
  if (!draftId) throw new Error("draftId is required");
  const vault = await getVault();
  const result = await vault.updateDraftBody(draftId, body);
  revalidatePath(`/drafts/${draftId}`);
  revalidatePath("/drafts");
  return { changed: result.changed };
}

/**
 * Save AI-generated content as a new draft file in `Drafts/`. The
 * agent's first pass is snapshotted into frontmatter (`original_body`)
 * so archive-time diffs can teach the style guide later.
 */
export async function saveAsDraftAction(input: {
  project_slug?: string;
  title: string;
  body: string;
  original_body?: string;
  source_agent?: string;
  subject?: string;
  channel?: string;
}): Promise<{ draft_id: string; relative_path: string }> {
  if (!input.title.trim()) throw new Error("title is required");
  if (!input.body.trim()) throw new Error("body is required");
  const vault = await getVault();
  const result = await vault.createDraftFromAi(input);
  revalidatePath("/drafts");
  if (input.project_slug) {
    revalidatePath(`/projects/${input.project_slug}`);
  }
  return {
    draft_id: result.draft_id,
    relative_path: result.relative_path,
  };
}
