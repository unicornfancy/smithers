"use server";

import { revalidatePath } from "next/cache";

import { getVault } from "@/lib/server/vault";

export async function addAgendaItemAction(
  filename: string,
  text: string,
  options?: { group?: string },
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: string }> {
  if (!filename) return { ok: false, reason: "filename is required" };
  const vault = await getVault();
  try {
    const result = await vault.addAgendaItem(filename, text, options);
    revalidatePath(`/agendas/${slugifyFilename(filename)}`);
    revalidatePath(`/agendas`);
    // The agenda also surfaces on every project workbench whose partner
    // matches; revalidate the wildcard so an open workbench picks up
    // the new item without a hard refresh.
    revalidatePath("/projects/[slug]", "page");
    return { ok: true, changed: result.changed };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to add item",
    };
  }
}

export async function toggleAgendaItemAction(
  filename: string,
  itemId: string,
  checked: boolean,
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: string }> {
  if (!filename || !itemId) {
    return { ok: false, reason: "filename and itemId are required" };
  }
  const vault = await getVault();
  try {
    const result = await vault.setAgendaItemChecked(filename, itemId, checked);
    revalidatePath(`/agendas/${slugifyFilename(filename)}`);
    revalidatePath("/projects/[slug]", "page");
    return { ok: true, changed: result.changed };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to toggle item",
    };
  }
}

export async function archiveCheckedAgendaItemsAction(
  filename: string,
  dateLabel?: string,
): Promise<
  { ok: true; archived: number } | { ok: false; reason: string }
> {
  if (!filename) return { ok: false, reason: "filename is required" };
  const vault = await getVault();
  const label = (dateLabel ?? new Date().toISOString().slice(0, 10)).trim();
  try {
    const result = await vault.archiveCheckedAgendaItems(filename, label);
    revalidatePath(`/agendas/${slugifyFilename(filename)}`);
    revalidatePath(`/agendas`);
    revalidatePath("/projects/[slug]", "page");
    return { ok: true, archived: result.archived };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to archive items",
    };
  }
}

// Local slugifier — kept inline to avoid pulling @smithers/vault into a
// "use server" file (action transforms can't tolerate the cjs/esm boundary
// when a barrel module pulls node:crypto helpers).
function slugifyFilename(filename: string): string {
  return filename
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
