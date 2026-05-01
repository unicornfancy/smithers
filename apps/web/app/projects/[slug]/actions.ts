"use server";

import { revalidatePath } from "next/cache";

import {
  suggestNextStep,
  type SuggestNextStepOutput,
} from "@smithers/agents";
import type {
  LinearProjectMetadata,
  ZendeskSearchResult,
} from "@smithers/mcp-client";
import type { UpdateProjectFrontmatterPatch } from "@smithers/vault";
import {
  filterFollowUpsForProject,
  parseProjectTasks,
  splitTasks,
} from "@smithers/vault";

import { getAgentRuntime } from "@/lib/server/agents";
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
 * Attach a Zendesk ticket to the project's frontmatter. Accepts either a
 * bare ref (id or URL) or a richer summary object — when the summary
 * form is supplied, subject/status/updated_at are persisted so the
 * panel can render without an upstream lookup. Idempotent: duplicates
 * (matched by canonical numeric id) are silently skipped.
 */
export async function attachZendeskTicketAction(
  slug: string,
  ticket:
    | string
    | {
        id: string;
        subject?: string | null;
        status?: string | null;
        priority?: string | null;
        updated_at?: string | null;
      },
): Promise<{ added: boolean; total: number }> {
  if (!slug) throw new Error("slug is required");
  if (!ticket) throw new Error("Ticket reference is required");

  const arg =
    typeof ticket === "string"
      ? ticket.trim()
      : {
          id: ticket.id,
          subject: ticket.subject ?? undefined,
          status: ticket.status ?? undefined,
          priority: ticket.priority ?? undefined,
          updated_at: ticket.updated_at ?? undefined,
        };
  if (typeof arg === "string" && !arg) {
    throw new Error("Ticket reference is required");
  }

  const vault = await getVault();
  const result = await vault.addProjectZendeskTicket(slug, arg);

  revalidatePath(`/projects/${slug}`);
  return { added: result.added, total: result.zendesk_tickets.length };
}

/**
 * One-shot backfill of zendesk_tickets metadata. Fans out search
 * queries based on supplied hints (auto-detected: partner display
 * name, deslugged partner, project name) plus any persisted
 * `zendesk_search_terms` from frontmatter (user-curated emails or
 * names that reliably surface this project's tickets). Merges
 * matching results into frontmatter so subsequent renders read
 * subject/status directly without an upstream call.
 */
export async function refreshZendeskMetadataAction(
  slug: string,
  hints: string[],
): Promise<{ updated: number; total: number }> {
  if (!slug) throw new Error("slug is required");

  const vault = await getVault();
  const project = await vault.readProject(slug);
  if (!project) throw new Error(`Project "${slug}" not found`);
  const refs = project.zendesk_tickets ?? [];
  if (refs.length === 0) return { updated: 0, total: 0 };

  const targetIds = new Set(refs.map((r) => r.id));
  const seen = new Map<
    string,
    {
      id: string;
      subject?: string;
      status?: string;
      priority?: string;
      updated_at?: string;
    }
  >();

  // Union auto-hints with user-curated search terms. Dedup so we
  // don't pay for duplicate queries when partner display name and a
  // configured term overlap.
  const allHints = Array.from(
    new Set([
      ...hints.map((h) => h.trim()).filter(Boolean),
      ...(project.zendesk_search_terms ?? []).map((h) => h.trim()).filter(Boolean),
    ]),
  );

  const mcp = await getMcpClient();
  await Promise.all(
    allHints.map(async (hint) => {
      const res = await mcp.contextA8C
        .searchZendeskTickets(hint, { limit: 50 })
        .catch(() => ({ ok: false as const, error: "search failed" }));
      if (!res.ok) return;
      for (const t of res.tickets) {
        if (!targetIds.has(t.id)) continue;
        if (!seen.has(t.id)) {
          seen.set(t.id, {
            id: t.id,
            subject: t.subject ?? undefined,
            status: t.status ?? undefined,
            priority: t.priority ?? undefined,
            updated_at: t.updated_at ?? undefined,
          });
        }
      }
    }),
  );

  const result = await vault.refreshProjectZendeskMetadata(
    slug,
    Array.from(seen.values()),
  );
  revalidatePath(`/projects/${slug}`);
  return { updated: result.updated, total: refs.length };
}

/**
 * Apply a partial frontmatter patch to the project file. The vault
 * helper handles the atomic write and the empty-string-clears
 * semantics. revalidates the workbench so changes show up immediately.
 */
export async function updateProjectMetadataAction(
  slug: string,
  patch: UpdateProjectFrontmatterPatch,
): Promise<{ changed: boolean }> {
  if (!slug) throw new Error("slug is required");
  const vault = await getVault();
  const result = await vault.updateProjectFrontmatter(slug, patch);
  revalidatePath(`/projects/${slug}`);
  return { changed: result.changed };
}

/**
 * Look up Linear project metadata for the metadata edit modal's
 * "Sync from Linear" sidebar. Returns null when neither id nor slug
 * is configured or when the upstream call fails — the modal degrades
 * gracefully (shows a "couldn't fetch" hint instead of the values).
 */
export async function fetchLinearProjectMetadataAction(
  slug: string,
): Promise<LinearProjectMetadata | null> {
  if (!slug) throw new Error("slug is required");
  const vault = await getVault();
  const project = await vault.readProject(slug);
  if (!project) return null;
  if (!project.linear_project_id && !project.linear_project_slug) return null;
  const mcp = await getMcpClient();
  return mcp.contextA8C
    .getLinearProjectMetadata({
      project_id: project.linear_project_id,
      project_slug: project.linear_project_slug,
    })
    .catch(() => null);
}

/**
 * Run the suggest-next-step agent for this project. Gathers context
 * (zendesk threads with persisted subjects, active follow-ups for the
 * project, open items from the body) and asks Claude for 1-3 picks
 * the user can act on right now.
 *
 * Returns null when the API key isn't configured so the panel can
 * surface a setup CTA instead of a hard error.
 */
export async function suggestNextStepAction(
  slug: string,
): Promise<
  | { ok: true; data: SuggestNextStepOutput }
  | { ok: false; reason: "not-configured" | "error"; message?: string }
> {
  if (!slug) throw new Error("slug is required");
  const runtime = await getAgentRuntime();
  if (!runtime) {
    return { ok: false, reason: "not-configured" };
  }
  const vault = await getVault();
  const detail = await vault.readProjectDetail(slug);
  if (!detail) {
    return { ok: false, reason: "error", message: "Project not found" };
  }

  // Pull project-scoped follow-ups + open items from the same source the
  // workbench panel uses, so the agent sees the same data the user does.
  const followUps = await vault.listFollowUps().catch(() => ({
    active: [] as Awaited<ReturnType<typeof vault.listFollowUps>>["active"],
    resolved: [] as Awaited<ReturnType<typeof vault.listFollowUps>>["resolved"],
  }));
  const projectActive = filterFollowUpsForProject(followUps.active, detail);
  const tasks = parseProjectTasks(detail.body);
  const { open } = splitTasks(tasks);

  // Active threads (open / pending / new / hold), excluding closed.
  const allThreads = detail.zendesk_tickets ?? [];
  const activeThreads = allThreads
    .filter((t) => {
      const s = (t.status ?? "").toLowerCase();
      return s !== "solved" && s !== "closed";
    })
    .map((t) => ({
      id: t.id,
      subject: t.subject ?? null,
      status: t.status ?? null,
      updated_at: t.updated_at ?? null,
    }));

  try {
    const result = await suggestNextStep(runtime, {
      project: detail,
      zendeskThreads: activeThreads,
      activeFollowUps: projectActive,
      openTasks: open,
      today: new Date().toISOString().slice(0, 10),
    });
    return { ok: true, data: result.output };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message:
        err instanceof Error ? err.message : "Agent call failed",
    };
  }
}

/**
 * Save the user-curated search terms used by the Refresh flow.
 * Empty array clears the field from frontmatter.
 */
export async function setZendeskSearchTermsAction(
  slug: string,
  terms: string[],
): Promise<{ changed: boolean; terms: string[] }> {
  if (!slug) throw new Error("slug is required");
  const vault = await getVault();
  const result = await vault.setProjectZendeskSearchTerms(slug, terms);
  revalidatePath(`/projects/${slug}`);
  return {
    changed: result.changed,
    terms: result.zendesk_search_terms,
  };
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
