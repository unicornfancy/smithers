"use server";

import { revalidatePath } from "next/cache";

import { clearCachedFor } from "@/lib/server/llm-cache";
import {
  clearAction,
  type ActionKind,
  type EntityType,
} from "@/lib/server/user-actions";

/**
 * Undo a previously-recorded user action. The Activity Log is the
 * single audit + recovery surface for everything Smithers has been
 * told to do — pin / demote / dismiss / accept all flow through here.
 *
 * Mirrors the cache-invalidation logic from /today's mutating actions:
 * undoing anything Top-3-relevant clears both LLM caches so the next
 * /today render reflects the restored candidate set.
 */
export async function undoActionEntry(
  entityType: EntityType,
  entityId: string,
  action: ActionKind,
): Promise<void> {
  if (!entityType || !entityId || !action) {
    throw new Error("entityType, entityId, and action are all required");
  }
  await clearAction(entityType, entityId, action);

  // Almost any undo can change Top 3 / Realistic Shape: dismissing a
  // ping pulled it from candidates; pinning bumped one to the top;
  // accepting a stall removed a follow-up. Cheaper to invalidate both
  // caches than to reason about which ones are actually stale.
  await Promise.all([
    clearCachedFor("top-3"),
    clearCachedFor("realistic-shape"),
  ]);

  revalidatePath("/today");
  revalidatePath("/settings");
  revalidatePath("/projects/[slug]", "page");
}
