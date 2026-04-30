"use server";

import { revalidatePath } from "next/cache";

import {
  applyHiveMindEntry,
  previewHiveMindEntry,
  type PreviewError,
  type PreviewResult,
} from "@/lib/server/hive-mind-reconcile";

/**
 * Generate the partner-knowledge.md preview for a vault partner. The
 * UI shows the user the exact bytes that would be written so they can
 * confirm before applying.
 */
export async function previewHiveMindEntryAction(
  partnerSlug: string,
): Promise<PreviewResult | PreviewError> {
  if (!partnerSlug) {
    return { ok: false, error: "partnerSlug is required" };
  }
  return previewHiveMindEntry(partnerSlug);
}

/**
 * Write the partner-knowledge.md to the user's Hive Mind clone. Stops
 * short of `git` — the pause point is "first vault writes against a
 * partner-kind project" per CLAUDE.md, and the same caution applies
 * to writes against the team-shared Hive Mind. The user reviews the
 * diff and commits manually.
 */
export async function applyHiveMindEntryAction(
  partnerSlug: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (!partnerSlug) {
    return { ok: false, error: "partnerSlug is required" };
  }
  const result = await applyHiveMindEntry(partnerSlug);
  if (result.ok) {
    revalidatePath("/settings");
    revalidatePath("/projects/[slug]", "page");
  }
  return result;
}
