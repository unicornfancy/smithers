"use server";

import { revalidatePath } from "next/cache";

import { dismiss } from "@/lib/server/user-actions";

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
