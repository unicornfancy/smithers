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
