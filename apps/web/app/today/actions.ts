"use server";

import { revalidatePath } from "next/cache";

import {
  clearAction,
  dismiss,
  recordAction,
} from "@/lib/server/user-actions";

/**
 * Dismiss an inbound ping. Records the breadcrumb in SQLite (so future
 * briefings know "Katie saw this and chose not to act") and refreshes
 * /today so the row disappears.
 */
export async function dismissPingAction(pingId: string): Promise<void> {
  if (!pingId) throw new Error("pingId is required");
  await dismiss("ping", pingId);
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
  revalidatePath("/today");
}

export async function unpinTop3Action(candidateId: string): Promise<void> {
  if (!candidateId) throw new Error("candidateId is required");
  await clearAction("top3_candidate", candidateId, "pin");
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
  revalidatePath("/today");
}

export async function restoreTop3Action(candidateId: string): Promise<void> {
  if (!candidateId) throw new Error("candidateId is required");
  await clearAction("top3_candidate", candidateId, "demote");
  revalidatePath("/today");
}
