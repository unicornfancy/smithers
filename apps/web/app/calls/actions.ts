"use server";

import { revalidatePath } from "next/cache";

import { getVault } from "@/lib/server/vault";

/**
 * Append a search term to a project's `fathom_search_terms`. Used by the
 * /calls "Match to project" picker — the term is typically a partner
 * contact name or a fragment of the recording title that will route
 * future calls automatically.
 */
export async function addFathomSearchTermAction(
  slug: string,
  term: string,
): Promise<{ ok: true; terms: string[] } | { ok: false; reason: string }> {
  const trimmed = term.trim();
  if (!slug || !trimmed) {
    return { ok: false, reason: "slug and term are required" };
  }
  const vault = await getVault();
  try {
    const project = await vault.readProject(slug);
    if (!project) return { ok: false, reason: "Project not found" };
    const next = Array.from(
      new Set([...(project.fathom_search_terms ?? []), trimmed]),
    );
    const result = await vault.setProjectFathomSearchTerms(slug, next);
    revalidatePath("/calls");
    revalidatePath(`/projects/${slug}`);
    return { ok: true, terms: result.fathom_search_terms };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed",
    };
  }
}
