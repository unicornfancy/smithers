"use server";

import { revalidatePath } from "next/cache";

import {
  suggestWeeklyHighlights,
  type SuggestWeeklyHighlightsOutput,
} from "@smithers/agents";

import { getAgentRuntime } from "@/lib/server/agents";
import { collectDigestCandidates } from "@/lib/server/digest-facts";
import { getVault } from "@/lib/server/vault";

export async function saveWeeklyHighlightAction(input: {
  isoWeek: string;
  body: string;
}): Promise<
  | { ok: true; relative_path: string; changed: boolean }
  | { ok: false; reason: string }
> {
  if (!input.isoWeek) return { ok: false, reason: "isoWeek is required" };
  try {
    const vault = await getVault();
    const result = await vault.saveWeeklyHighlight({
      iso_week: input.isoWeek,
      body: input.body ?? "",
    });
    revalidatePath("/digest");
    revalidatePath("/today");
    return {
      ok: true,
      relative_path: result.relative_path,
      changed: result.changed,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "save failed",
    };
  }
}

export async function savePersonalDevelopmentAction(
  body: string,
): Promise<
  | { ok: true; relative_path: string; changed: boolean }
  | { ok: false; reason: string }
> {
  try {
    const vault = await getVault();
    const result = await vault.savePersonalDevelopment(body ?? "");
    revalidatePath("/digest");
    return {
      ok: true,
      relative_path: result.relative_path,
      changed: result.changed,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "save failed",
    };
  }
}

/**
 * Collect this week's candidate moments + run them through the
 * suggest-weekly-highlights agent. Returns the ranked picks so the
 * UI can render them as "Add to highlight" rows.
 *
 * `not-configured` when ANTHROPIC_API_KEY is missing — the UI surfaces
 * a setup CTA instead of an error.
 */
export async function suggestWeeklyHighlightsAction(
  isoWeek: string,
): Promise<
  | { ok: true; data: SuggestWeeklyHighlightsOutput; candidate_count: number }
  | { ok: false; reason: "not-configured" | "no-candidates" | "error"; message?: string }
> {
  if (!isoWeek) return { ok: false, reason: "error", message: "isoWeek is required" };
  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const facts = await collectDigestCandidates(isoWeek);
  if (!facts) {
    return { ok: false, reason: "error", message: "Bad iso_week" };
  }
  if (facts.candidates.length === 0) {
    return { ok: false, reason: "no-candidates" };
  }
  try {
    const result = await suggestWeeklyHighlights(runtime, {
      iso_week: facts.iso_week,
      window_start: facts.window_start,
      window_end: facts.window_end,
      candidates: facts.candidates,
    });
    return {
      ok: true,
      data: result.output,
      candidate_count: facts.candidates.length,
    };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Agent call failed",
    };
  }
}
