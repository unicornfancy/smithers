"use server";

import { revalidatePath } from "next/cache";

import type { ZendeskSearchResult } from "@smithers/mcp-client";

import { getMcpClient } from "@/lib/server/mcp";
import { getVault } from "@/lib/server/vault";

/**
 * Flip a single Open Items checkbox in a project's markdown body. Writes
 * straight to the vault file (atomic), then refreshes the workbench so
 * the row repaints in its new lane (open ↔ done).
 *
 * The vault helper re-parses the file at toggle time so a slightly stale
 * task_id from the client (e.g. user added a new task in Obsidian since
 * page render) still resolves — task ids are content-derived, not
 * line-position-derived.
 */
export async function toggleProjectTaskAction(
  slug: string,
  taskId: string,
  done: boolean,
): Promise<void> {
  if (!slug) throw new Error("slug is required");
  if (!taskId) throw new Error("taskId is required");

  const vault = await getVault();
  await vault.toggleProjectTask(slug, taskId, done);

  revalidatePath(`/projects/${slug}`);
}

/**
 * Append a new `- [ ] <text>` task to the project body. Mirrors the
 * toggle action: writes the file, then revalidates the workbench so
 * the new row appears.
 */
export async function addProjectTaskAction(
  slug: string,
  text: string,
): Promise<void> {
  if (!slug) throw new Error("slug is required");
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Task text is required");

  const vault = await getVault();
  await vault.appendProjectTask(slug, trimmed);

  revalidatePath(`/projects/${slug}`);
}

/**
 * Replace a task's text. The vault helper preserves the line's indent,
 * bullet, and checkbox state and returns the new task_id (which is
 * text-derived and changes with the rename).
 */
export async function editProjectTaskTextAction(
  slug: string,
  taskId: string,
  newText: string,
): Promise<void> {
  if (!slug) throw new Error("slug is required");
  if (!taskId) throw new Error("taskId is required");
  const trimmed = newText.trim();
  if (!trimmed) throw new Error("Task text is required");

  const vault = await getVault();
  await vault.editProjectTaskText(slug, taskId, trimmed);

  revalidatePath(`/projects/${slug}`);
}

/**
 * Remove a single task line from the project body. No confirmation here —
 * the click is intentional and the file lives in git/Obsidian, so recovery
 * is cheap if it was a mistake.
 */
export async function deleteProjectTaskAction(
  slug: string,
  taskId: string,
): Promise<void> {
  if (!slug) throw new Error("slug is required");
  if (!taskId) throw new Error("taskId is required");

  const vault = await getVault();
  await vault.deleteProjectTask(slug, taskId);

  revalidatePath(`/projects/${slug}`);
}

/**
 * Free-text Zendesk ticket search for the "Attach Zendesk thread" modal.
 * Returns the typed result shape directly so the client can branch on
 * ok/error without parsing strings.
 */
export async function searchZendeskTicketsAction(
  query: string,
): Promise<ZendeskSearchResult> {
  if (!query.trim()) return { ok: true, tickets: [] };
  const mcp = await getMcpClient();
  return mcp.contextA8C.searchZendeskTickets(query, { limit: 20 });
}

/**
 * Attach a Zendesk ticket reference (raw id or full URL) to the project's
 * frontmatter. Idempotent — duplicates are silently skipped, surfaced via
 * the `added` flag so the UI can give the right feedback.
 */
export async function attachZendeskTicketAction(
  slug: string,
  ticketRef: string,
): Promise<{ added: boolean; total: number }> {
  if (!slug) throw new Error("slug is required");
  const trimmed = ticketRef.trim();
  if (!trimmed) throw new Error("Ticket reference is required");

  const vault = await getVault();
  const result = await vault.addProjectZendeskTicket(slug, trimmed);

  revalidatePath(`/projects/${slug}`);
  return { added: result.added, total: result.zendesk_tickets.length };
}

/**
 * Promote a Zendesk ticket to primary by reordering the project's
 * frontmatter array so the picked ticket lands at position 0.
 */
export async function setPrimaryZendeskTicketAction(
  slug: string,
  ticketId: string,
): Promise<{ changed: boolean }> {
  if (!slug) throw new Error("slug is required");
  if (!ticketId) throw new Error("ticketId is required");

  const vault = await getVault();
  const result = await vault.setPrimaryZendeskTicket(slug, ticketId);

  revalidatePath(`/projects/${slug}`);
  return { changed: result.changed };
}

/**
 * Mark a follow-up as resolved in Follow-ups.md. Optional note is
 * appended to the Status cell as "Resolved — <note>" so the user can
 * leave a quick reason for future-them.
 */
export async function resolveFollowUpAction(
  slug: string,
  followUpId: string,
  note?: string,
): Promise<{ changed: boolean }> {
  if (!slug) throw new Error("slug is required");
  if (!followUpId) throw new Error("followUpId is required");

  const vault = await getVault();
  const result = await vault.resolveFollowUp(followUpId, note);

  revalidatePath(`/projects/${slug}`);
  return { changed: result.changed };
}
