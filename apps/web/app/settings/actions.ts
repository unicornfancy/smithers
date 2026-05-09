"use server";

import { revalidatePath } from "next/cache";

import {
  configLocalPath,
  isObject,
  readYamlFile,
  writeYamlAtomic,
} from "@/lib/server/config-write";
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

/**
 * Patch `weekly_update.format_template` in config.local.yaml. Pass an
 * empty string to clear the override (back to the agent's built-in
 * default). The template is free-form prose handed to the agent at
 * generate time — it can include the 3 starter presets verbatim or
 * any custom format.
 */
export async function updateWeeklyUpdateFormatAction(
  template: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const path = configLocalPath();
    const current = await readYamlFile(path);
    const next = structuredClone(current) as Record<string, unknown>;
    const block = isObject(next["weekly_update"])
      ? (next["weekly_update"] as Record<string, unknown>)
      : {};
    const trimmed = template.trim();
    if (trimmed === "") {
      delete block["format_template"];
    } else {
      block["format_template"] = trimmed;
    }
    if (Object.keys(block).length > 0) {
      next["weekly_update"] = block;
    } else {
      delete next["weekly_update"];
    }
    await writeYamlAtomic(path, next);
    revalidatePath("/settings");
    revalidatePath("/weekly-updates/[isoWeek]", "page");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "write failed",
    };
  }
}
