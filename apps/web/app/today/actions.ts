"use server";

import { revalidatePath } from "next/cache";

import { clearCachedFor } from "@/lib/server/llm-cache";
import {
  recomputeActioned,
  type PingActionedInput,
} from "@/lib/server/ping-actioned";
import {
  clearAction,
  dismiss,
  recordAction,
} from "@/lib/server/user-actions";

/**
 * Drop both LLM caches whenever the candidate set changes. Top 3 picks
 * obviously depend on which candidates are in/out; Realistic Shape
 * depends on Top 3 + stall counts, so it's also stale.
 */
async function invalidateLlmCaches(): Promise<void> {
  await Promise.all([
    clearCachedFor("top-3"),
    clearCachedFor("realistic-shape"),
  ]);
}

/**
 * Dismiss an inbound ping. Records the breadcrumb in SQLite (so future
 * briefings know "Katie saw this and chose not to act") and refreshes
 * /today so the row disappears.
 */
export async function dismissPingAction(pingId: string): Promise<void> {
  if (!pingId) throw new Error("pingId is required");
  await dismiss("ping", pingId);
  // Pings drive Top 3 candidates and inform Realistic Shape's ping
  // count — both go stale when one is dismissed.
  await invalidateLlmCaches();
  revalidatePath("/today");
}

/**
 * Pin a Top 3 candidate so it always appears in today's Top 3 regardless
 * of score. Also revalidates the project workbench in case the same
 * candidate surfaces there (future: pinned-elsewhere indicator).
 */
export async function pinTop3Action(candidateId: string): Promise<void> {
  if (!candidateId) throw new Error("candidateId is required");
  // If the user previously demoted this candidate, pinning should clear
  // that — they've changed their mind.
  await clearAction("top3_candidate", candidateId, "demote");
  await recordAction("top3_candidate", candidateId, "pin");
  await invalidateLlmCaches();
  revalidatePath("/today");
}

export async function unpinTop3Action(candidateId: string): Promise<void> {
  if (!candidateId) throw new Error("candidateId is required");
  await clearAction("top3_candidate", candidateId, "pin");
  await invalidateLlmCaches();
  revalidatePath("/today");
}

/**
 * Demote a candidate so it's excluded from Top 3 ranking. The candidate
 * still appears on its source surface (follow-ups list, project page,
 * etc.) — demote only affects Top 3 picks.
 */
export async function demoteTop3Action(candidateId: string): Promise<void> {
  if (!candidateId) throw new Error("candidateId is required");
  // Inverse of pin: clear any existing pin, then record the demote.
  await clearAction("top3_candidate", candidateId, "pin");
  await recordAction("top3_candidate", candidateId, "demote");
  await invalidateLlmCaches();
  revalidatePath("/today");
}

export async function restoreTop3Action(candidateId: string): Promise<void> {
  if (!candidateId) throw new Error("candidateId is required");
  await clearAction("top3_candidate", candidateId, "demote");
  await invalidateLlmCaches();
  revalidatePath("/today");
}

/**
 * Accept a stall: "I've decided. This is going to sit. Stop surfacing
 * it." Removes the row from /today's Stalls card AND from the per-
 * project Needs Decision panel, AND from Top 3 candidate scoring. The
 * underlying follow-up row is left alone — /follow-ups still shows it
 * with its waiting status, so the user can flip the decision later.
 */
export async function acceptStallAction(stallId: string): Promise<void> {
  if (!stallId) throw new Error("stallId is required");
  await recordAction("stall", stallId, "accept");
  await invalidateLlmCaches();
  // Both /today and the project workbench surface stalls.
  revalidatePath("/today");
  revalidatePath("/projects/[slug]", "page");
}

export async function unacceptStallAction(stallId: string): Promise<void> {
  if (!stallId) throw new Error("stallId is required");
  await clearAction("stall", stallId, "accept");
  await invalidateLlmCaches();
  revalidatePath("/today");
  revalidatePath("/projects/[slug]", "page");
}

/**
 * Recompute "did Katie already reply" for the given pings (typically
 * the current /today list). Fans out per-source MCP calls in parallel,
 * writes verdicts to the ping_actioned cache, and revalidates so the
 * panel re-renders with the new verdicts.
 *
 * Callers pass a lightweight subset of `Ping` — only id, source, url,
 * and timestamp are read by the orchestrator.
 */
export async function refreshPingsActionedAction(
  pings: PingActionedInput[],
): Promise<{ checked: number; actioned: number }> {
  const result = await recomputeActioned(pings);
  revalidatePath("/today");
  return result;
}
