"use server";

import { revalidatePath } from "next/cache";

import {
  analyzeCallTranscript,
  chatAboutTranscript,
  composeCallRecap,
  composeFollowUpNudge,
  draftP2Update,
  draftZendeskReply,
  runHiveMindSkill,
  suggestNextStep,
  summarizeZendeskThread,
  type AnalyzeCallTranscriptOutput,
  type CallActionItem,
  type CallDecision,
  type CallFollowUp,
  type ComposeCallRecapOutput,
  type ComposeNudgeOutput,
  type DraftP2UpdateOutput,
  type DraftZendeskReplyOutput,
  type RunSkillOutput,
  type SummarizeZendeskThreadComment,
  type SummarizeZendeskThreadOutput,
  type SuggestNextStepOutput,
} from "@smithers/agents";
import type {
  CallRecordingRef,
  ContextItem,
  LinearIssue,
  LinearIssueDetail,
  LinearProject,
  LinearProjectMetadata,
  LinearProjectUpdate,
  P2Post,
  ZendeskSearchResult,
} from "@smithers/mcp-client";
import type {
  ChatMessage,
  HiveMindPinnedContextRow,
  UpdateProjectFrontmatterPatch,
  UpdateFollowUpPatch,
} from "@smithers/vault";
import {
  filterFollowUpsForProject,
  parseProjectTasks,
  serializeHiveMindPinnedContext,
  slugify,
  splitTasks,
} from "@smithers/vault";

import { getAgentRuntime } from "@/lib/server/agents";
import { loadConfig } from "@/lib/server/config";
import { buildPartnerKnowledgeFrontmatterUpdate } from "@/lib/server/hive-mind-frontmatter";
import { writeLaunchPostImage } from "@/lib/server/launch-post-assets";
import { getMcpClient } from "@/lib/server/mcp";
import { loadStyleReference } from "@/lib/server/style";
import { getTranscriptionAdapter } from "@/lib/server/transcription";
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
 * Append a task to a project's Open Items, embedding the originating
 * activity event's URL as a trailing markdown link so the user can jump
 * back to the source later (and so Smithers can detect "the underlying
 * activity has been resolved" in a future auto-mark-done slice).
 *
 * Source URL is appended to the user-edited text as ` — [source](<url>)`
 * if the user didn't already include the URL in the text. Empty URL =
 * plain text task (delegates to addProjectTaskAction's shape).
 */
export async function addProjectTaskFromActivityAction(
  slug: string,
  text: string,
  sourceUrl: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    if (!slug) throw new Error("slug is required");
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Task text is required");

    const finalText =
      sourceUrl && sourceUrl.trim() && !trimmed.includes(sourceUrl.trim())
        ? `${trimmed} — [source](${sourceUrl.trim()})`
        : trimmed;

    const vault = await getVault();
    await vault.appendProjectTask(slug, finalText);
    revalidatePath(`/projects/${slug}`);
    revalidatePath("/today");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to add task",
    };
  }
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

export interface SuggestedZendeskTicket {
  id: string;
  subject: string | null;
  status: string | null;
  updated_at: string | null;
  /** The search term that surfaced this ticket — usually the matching email. */
  matched_term: string;
}

/**
 * Surface Zendesk tickets that look like they belong to this project but
 * aren't yet attached. Fans out searches across:
 *
 *   - The HM partner's `contacts[].email` (canonical contacts per partner)
 *   - The project's `zendesk_search_terms` (per-project override hints)
 *
 * Filters out tickets already in `project.zendesk_tickets`. Returns a
 * discriminated result so the UI can branch cleanly on
 * not-configured / no-search-terms / error.
 *
 * The Zendesk provider exposes only `search`; no ticket-id filter that
 * works reliably (see CLAUDE.md gotchas), so we use the partner-email
 * angle to catch the typical "Martin filed a new ticket" case.
 */
export async function findSuggestedZendeskTicketsAction(
  slug: string,
): Promise<
  | { ok: true; data: SuggestedZendeskTicket[] }
  | {
      ok: false;
      reason: "not-configured" | "no-search-terms" | "error";
      message?: string;
    }
> {
  if (!slug) throw new Error("slug is required");
  const vault = await getVault();
  const project = await vault.readProject(slug);
  if (!project) {
    return { ok: false, reason: "error", message: `Project "${slug}" not found` };
  }

  const partnerSlug = project.hive_mind_partner_slug ?? project.partner ?? null;
  const partner = partnerSlug
    ? await vault.getHiveMindPartner(partnerSlug).catch(() => null)
    : null;

  const contactEmails = (partner?.contacts ?? [])
    .map((c) => c.email.trim())
    .filter(Boolean);
  const projectTerms = (project.zendesk_search_terms ?? [])
    .map((t) => t.trim())
    .filter(Boolean);

  // Dedup so we don't fire the same query twice if a per-project term
  // already lists a partner contact email.
  const allTerms = Array.from(new Set([...contactEmails, ...projectTerms]));
  if (allTerms.length === 0) {
    return { ok: false, reason: "no-search-terms" };
  }

  const attachedIds = new Set(
    (project.zendesk_tickets ?? []).map((t) => t.id),
  );

  const mcp = await getMcpClient();
  const seen = new Map<string, SuggestedZendeskTicket>();
  try {
    await Promise.all(
      allTerms.map(async (term) => {
        const res = await mcp.contextA8C
          .searchZendeskTickets(term, { limit: 25 })
          .catch(() => ({ ok: false as const, error: "search failed" }));
        if (!res.ok) return;
        for (const t of res.tickets) {
          if (attachedIds.has(t.id)) continue;
          if (seen.has(t.id)) continue;
          seen.set(t.id, {
            id: t.id,
            subject: t.subject,
            status: t.status,
            updated_at: t.updated_at,
            matched_term: term,
          });
        }
      }),
    );
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "search failed",
    };
  }

  // Newest first so the most recent tickets are the most actionable.
  const data = Array.from(seen.values()).sort((a, b) =>
    (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
  );
  return { ok: true, data };
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
  await syncZendeskToHiveMind(slug);
  return { added: result.added, total: result.zendesk_tickets.length };
}

/**
 * Push the project's current vault zendesk_tickets to Hive-Mind's
 * `zendesk.md`. Called whenever vault frontmatter changes (attach,
 * refresh-metadata, etc.) so the workbench — which reads from HM when
 * connected — stays in sync. No-op when the project isn't HM-linked.
 * Failures are silent: HM sync is non-fatal, vault remains correct.
 */
async function syncZendeskToHiveMind(slug: string): Promise<void> {
  try {
    const vault = await getVault();
    const project = await vault.readProject(slug);
    if (!project?.hive_mind_partner_slug) return;
    const hmPartner = project.hive_mind_partner_slug;
    const hmProject = project.hive_mind_project_slug ?? project.slug;
    const tickets = project.zendesk_tickets ?? [];
    const content = serializeHMZendesk({
      search_terms: project.zendesk_search_terms ?? [],
      last_refreshed: new Date().toISOString().slice(0, 10),
      tickets: tickets.map((t) => ({
        ticket_id: parseInt(t.id, 10),
        subject: t.subject ?? "",
        status: t.status ?? "",
        url: `https://automattic.zendesk.com/agent/tickets/${t.id}`,
      })),
    });
    const mcp = await getMcpClient();
    await mcp.hiveMind.writeProjectFile(hmPartner, hmProject, "zendesk.md", content);
    await mcp.hiveMind.commit(`zendesk: sync ticket list for ${hmPartner}/${hmProject}`);
  } catch {
    /* HM sync failure is non-fatal — vault is the source of truth. */
  }
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
  // Push the full updated vault state to HM zendesk.md — even tickets
  // the search didn't touch get re-serialized so a previously-attached
  // ticket with null HM metadata picks up its vault subject/status.
  await syncZendeskToHiveMind(slug);
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
 * Run the compose-followup-nudge agent for a single follow-up. The
 * agent reads the follow-up + its parent project context + the
 * user's style guide (when one exists) and drafts a short message
 * the user can copy into the right channel.
 *
 * Returns a discriminated result so the dialog can show a setup CTA
 * or a clean error instead of crashing.
 */
export async function composeFollowUpNudgeAction(
  slug: string,
  followUpId: string,
  extraContext?: ContextItem[],
  /** Free-form intent string from the picker — what the user wants this nudge to do/say. */
  intent?: string,
): Promise<
  | { ok: true; data: ComposeNudgeOutput }
  | { ok: false; reason: "not-configured" | "error"; message?: string }
> {
  if (!slug) throw new Error("slug is required");
  if (!followUpId) throw new Error("followUpId is required");

  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const vault = await getVault();
  const project = await vault.readProject(slug);
  if (!project) return { ok: false, reason: "error", message: "Project not found" };
  const followUps = await vault.listFollowUps().catch(() => ({
    active: [] as Awaited<ReturnType<typeof vault.listFollowUps>>["active"],
    resolved: [] as Awaited<ReturnType<typeof vault.listFollowUps>>["resolved"],
  }));
  const followUp = [...followUps.active, ...followUps.resolved].find(
    (f) => f.follow_up_id === followUpId,
  );
  if (!followUp) {
    return {
      ok: false,
      reason: "error",
      message: `Follow-up ${followUpId} not found in Follow-ups.md`,
    };
  }

  const daysWaiting = followUp.sent
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - Date.parse(followUp.sent)) / 86_400_000,
        ),
      )
    : undefined;

  const style = (await loadStyleReference()) ?? undefined;

  try {
    const result = await composeFollowUpNudge(runtime, {
      followUp,
      project,
      daysWaiting,
      style,
      extra_context: extraContext,
      user_intent: intent?.trim() || undefined,
    });
    return { ok: true, data: result.output };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Agent call failed",
    };
  }
}

/**
 * Run the draft-zendesk-reply agent for a single attached ticket.
 * Pulls the ticket from frontmatter (subject + status persisted at
 * attach time), tries to enrich with the most recent partner +
 * internal comments via the activity fetch (best-effort — degrades
 * silently if comments aren't available), and asks Claude for a
 * short reply the user can copy into Zendesk.
 */
export async function draftZendeskReplyAction(
  slug: string,
  ticketId: string,
  intent?: string,
  extraContext?: ContextItem[],
): Promise<
  | { ok: true; data: DraftZendeskReplyOutput }
  | { ok: false; reason: "not-configured" | "error"; message?: string }
> {
  if (!slug) throw new Error("slug is required");
  if (!ticketId) throw new Error("ticketId is required");

  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const vault = await getVault();
  const project = await vault.readProject(slug);
  if (!project) return { ok: false, reason: "error", message: "Project not found" };

  const thread = (project.zendesk_tickets ?? []).find(
    (t) => t.id === ticketId,
  );
  if (!thread) {
    return {
      ok: false,
      reason: "error",
      message: `Ticket ${ticketId} is not attached to this project`,
    };
  }

  // Best-effort comment context. fetchZendeskTicketActivity returns
  // [] when the upstream tool isn't available, which is fine. Events
  // come back newest-first, so .find() yields the most recent of each
  // side without an extra sort.
  const mcp = await getMcpClient();
  const recent = await mcp.contextA8C
    .fetchZendeskTicketActivity(ticketId, {
      projectSlug: slug,
      limit: 10,
    })
    .catch(() => []);
  const lastPartner = recent.find((e) => e.actor?.is_external === true);
  const lastOurTeam = recent.find((e) => e.actor?.is_external === false);

  // Who replied LAST drives the agent's reply-vs-nudge branch. Compare
  // timestamps; if either side is absent the other wins by default.
  let lastResponder: "partner" | "our_team" | null = null;
  if (lastPartner && lastOurTeam) {
    lastResponder =
      lastPartner.timestamp > lastOurTeam.timestamp ? "partner" : "our_team";
  } else if (lastPartner) {
    lastResponder = "partner";
  } else if (lastOurTeam) {
    lastResponder = "our_team";
  }

  const style = (await loadStyleReference()) ?? undefined;

  try {
    const result = await draftZendeskReply(runtime, {
      project,
      thread: {
        id: thread.id,
        subject: thread.subject ?? null,
        status: thread.status ?? null,
        last_partner_excerpt: lastPartner?.excerpt ?? null,
        last_partner_at: lastPartner?.timestamp ?? null,
        last_our_team_excerpt: lastOurTeam?.excerpt ?? null,
        last_our_team_at: lastOurTeam?.timestamp ?? null,
        last_responder: lastResponder,
      },
      intent,
      style,
      extra_context: extraContext,
    });
    return { ok: true, data: result.output };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Agent call failed",
    };
  }
}

/**
 * Run the summarize-zendesk-thread agent for a single attached ticket.
 * Pulls subject + status from frontmatter, fetches the most recent
 * comments via ContextA8C (best-effort; agent gracefully handles the
 * empty case), and asks Claude for a short markdown summary the user
 * can skim. Read-only — no frontmatter persistence; copy-only dialog.
 */
export async function summarizeZendeskThreadAction(
  slug: string,
  ticketId: string,
): Promise<
  | { ok: true; data: SummarizeZendeskThreadOutput }
  | { ok: false; reason: "not-configured" | "error"; message?: string }
> {
  if (!slug) throw new Error("slug is required");
  if (!ticketId) throw new Error("ticketId is required");

  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const vault = await getVault();
  const project = await vault.readProject(slug);
  if (!project) {
    return { ok: false, reason: "error", message: "Project not found" };
  }

  const thread = (project.zendesk_tickets ?? []).find(
    (t) => t.id === ticketId,
  );
  if (!thread) {
    return {
      ok: false,
      reason: "error",
      message: `Ticket ${ticketId} is not attached to this project`,
    };
  }

  // Best-effort comment fetch. ContextA8C sessions expire intermittently
  // and the activity helper returns [] on any upstream error. The agent
  // handles the no-comments case gracefully (summarizes from subject +
  // status alone and notes the limitation).
  const mcp = await getMcpClient();
  const recent = await mcp.contextA8C
    .fetchZendeskTicketActivity(ticketId, {
      projectSlug: slug,
      limit: 30,
    })
    .catch(() => []);
  // fetchZendeskTicketActivity returns newest-first; the agent reads
  // oldest-first so the prompt mirrors the natural read order.
  const ordered = [...recent].reverse();
  const comments: SummarizeZendeskThreadComment[] = ordered.map((e) => ({
    author: e.actor?.name ?? "Zendesk",
    is_external: e.actor?.is_external === true,
    timestamp: e.timestamp,
    body: e.excerpt ?? "",
  }));

  try {
    const result = await summarizeZendeskThread(runtime, {
      project,
      thread: {
        id: thread.id,
        subject: thread.subject ?? null,
        status: thread.status ?? null,
      },
      comments,
    });
    return { ok: true, data: result.output };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Agent call failed",
    };
  }
}

// Map a saved call-notes analysis (vault shape; `owner: string`) back
// to the agent output shape (`owner?: "user"|"partner"|"team"|"unknown"`).
// Unknown strings collapse to "unknown" so the dialog stays well-typed.
async function coerceSavedAnalysisToAgentOutput(
  saved: import("@smithers/vault").SavedCallAnalysis,
): Promise<AnalyzeCallTranscriptOutput> {
  const allowedOwners = new Set(["user", "partner", "team", "unknown"]);
  return {
    summary: saved.summary,
    action_items: saved.action_items.map((a) => ({
      text: a.text,
      owner: allowedOwners.has(a.owner)
        ? (a.owner as "user" | "partner" | "team" | "unknown")
        : "unknown",
    })),
    follow_ups: saved.follow_ups.map((f) => ({
      task: f.task,
      rationale: f.rationale,
      follow_up_by: f.follow_up_by,
    })),
    decisions: saved.decisions.map((d) => ({
      text: d.text,
      context: d.context,
    })),
    key_quotes: saved.key_quotes.map((q) => ({
      speaker: q.speaker,
      text: q.text,
    })),
  };
}

/**
 * Pull the full transcript for a Fathom recording and hand it to the
 * analyze-call-transcript agent. Caches the result to a markdown file
 * in `Call Notes/` keyed by recording_id, so re-running Process on
 * the same recording returns the saved file instead of paying for
 * another LLM call (and another transcript fetch).
 *
 * Pass `{ force: true }` to bypass the cache and re-analyze. The
 * returned `cached` flag tells the UI whether the result came from
 * disk; `notes_path` is the relative vault path for "View notes" CTAs.
 */
export async function analyzeCallAction(
  slug: string,
  recordingId: string,
  url?: string,
  opts?: {
    force?: boolean;
    recording_title?: string;
    recorded_at?: string;
    additionalInstructions?: string;
  },
): Promise<
  | {
      ok: true;
      data: AnalyzeCallTranscriptOutput;
      cached: boolean;
      analyzed_at: string;
      notes_path?: string;
      /** Transcript text — present when freshly fetched; absent when served from cache. */
      transcript?: string;
    }
  | {
      ok: false;
      reason: "not-configured" | "transcript-missing" | "error";
      message?: string;
    }
> {
  if (!slug) throw new Error("slug is required");
  if (!recordingId) throw new Error("recordingId is required");

  const vault = await getVault();
  const project = await vault.readProject(slug);
  if (!project) return { ok: false, reason: "error", message: "Project not found" };

  // Cache hit path. Skip when `force: true` so the user can refresh
  // a stale analysis without renaming the file.
  if (!opts?.force) {
    const existing = await vault
      .findCallNotesByRecordingId(recordingId)
      .catch(() => null);
    if (existing) {
      return {
        ok: true,
        data: await coerceSavedAnalysisToAgentOutput(existing.analysis),
        cached: true,
        analyzed_at: existing.analyzed_at,
        notes_path: existing.relative_path,
      };
    }
  }

  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const mcp = await getMcpClient();
  const transcription = await getTranscriptionAdapter();
  const transcript = await transcription
    .fetchTranscript({ recording_id: recordingId, url })
    .catch(() => null);
  if (!transcript) {
    return {
      ok: false,
      reason: "transcript-missing",
      message:
        `Couldn't fetch the transcript from ${transcription.provider}. The recording may not be processed yet, or you may need to re-auth.`,
    };
  }

  const style = (await loadStyleReference()) ?? undefined;
  const cfg = await loadConfig();
  const systemPromptOverride =
    cfg.agents.analyze_call_transcript_prompt?.trim() || undefined;

  try {
    const result = await analyzeCallTranscript(runtime, {
      transcript,
      project,
      call: { recording_id: recordingId, url },
      style,
      additionalInstructions: opts?.additionalInstructions,
      systemPromptOverride,
    });
    // Write to Hive Mind call-transcripts/ as the primary record.
    const hmPartnerSlug = project.hive_mind_partner_slug ?? project.partner ?? project.slug;
    const hmProjectSlug = project.hive_mind_project_slug ?? project.slug;
    const today = new Date().toISOString().slice(0, 10);
    const callDate = opts?.recorded_at
      ? opts.recorded_at.slice(0, 10)
      : today;
    const callTitle = opts?.recording_title ?? "Call";
    const filename = `${callDate}-${slugify(callTitle)}.md`;

    const hmFileContent = buildCallTranscriptFile({
      title: callTitle,
      partnerSlug: hmPartnerSlug,
      projectSlug: hmProjectSlug,
      date: callDate,
      recordingUrl: url ?? null,
      transcriptionService: "fathom",
      updated: today,
      transcript: transcript ?? "",
      analysis: result.output,
    });

    let hmPath: string | undefined;
    try {
      const hiveMindClient = (await getMcpClient()).hiveMind;
      await hiveMindClient.writeProjectFile(
        hmPartnerSlug,
        hmProjectSlug,
        `call-transcripts/${filename}`,
        hmFileContent,
      );
      await hiveMindClient.commit(
        `feat(call-transcripts): add ${callDate} call for ${hmPartnerSlug}/${hmProjectSlug}`,
      );
      hmPath = `knowledge/partners/${hmPartnerSlug}/${hmProjectSlug}/call-transcripts/${filename}`;
    } catch {
      // Hive Mind write failure is non-fatal — local vault cache still written below.
    }

    // Also persist to local Call Notes/ for the cache-hit path on re-analyze.
    const saved = await vault
      .saveCallNotes({
        project_slug: slug,
        recording: {
          recording_id: recordingId,
          title: opts?.recording_title ?? null,
          recorded_at: opts?.recorded_at ?? null,
          url: url ?? null,
        },
        analysis: {
          summary: result.output.summary,
          action_items: result.output.action_items.map((a) => ({
            text: a.text,
            owner: a.owner ?? "unknown",
          })),
          follow_ups: result.output.follow_ups.map((f) => ({
            task: f.task,
            rationale: f.rationale,
            follow_up_by: f.follow_up_by,
          })),
          decisions: result.output.decisions.map((d) => ({
            text: d.text,
            context: d.context,
          })),
          key_quotes: result.output.key_quotes.map((q) => ({
            speaker: q.speaker,
            text: q.text,
          })),
        },
      })
      .catch(() => null);
    return {
      ok: true,
      data: result.output,
      cached: false,
      analyzed_at: saved?.analyzed_at ?? new Date().toISOString(),
      notes_path: hmPath ?? saved?.relative_path,
      transcript,
    };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Agent call failed",
    };
  }
}

/**
 * Fetch just the transcript text for a Fathom recording. Used by the
 * chat panel when the analysis was loaded from cache (in which case
 * analyzeCallAction doesn't re-fetch the transcript).
 */
export async function fetchTranscriptAction(
  recordingId: string,
  url?: string,
): Promise<
  | { ok: true; transcript: string }
  | { ok: false; message: string }
> {
  if (!recordingId) return { ok: false, message: "recordingId is required" };
  const mcp = await getMcpClient();
  const transcription = await getTranscriptionAdapter();
  const transcript = await transcription
    .fetchTranscript({ recording_id: recordingId, url })
    .catch(() => null);
  if (!transcript) {
    return {
      ok: false,
      message:
        "Couldn't fetch the transcript from Fathom. The recording may not be processed yet.",
    };
  }
  return { ok: true, transcript };
}

/**
 * Generate a P2 status post draft from a call transcript. Pulls the
 * transcript via Fathom, runs the draft-p2-update agent, returns
 * { title, body, rationale } the user can copy into the P2 composer.
 */
export async function draftP2UpdateFromCallAction(
  slug: string,
  recordingId: string,
  url?: string,
  extraContext?: ContextItem[],
  intent?: string,
): Promise<
  | { ok: true; data: DraftP2UpdateOutput }
  | {
      ok: false;
      reason: "not-configured" | "transcript-missing" | "error";
      message?: string;
    }
> {
  if (!slug) throw new Error("slug is required");
  if (!recordingId) throw new Error("recordingId is required");

  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const vault = await getVault();
  const project = await vault.readProject(slug);
  if (!project) return { ok: false, reason: "error", message: "Project not found" };

  const mcp = await getMcpClient();
  const transcription = await getTranscriptionAdapter();
  const transcript = await transcription
    .fetchTranscript({ recording_id: recordingId, url })
    .catch(() => null);
  if (!transcript) {
    return {
      ok: false,
      reason: "transcript-missing",
      message: `Couldn't fetch the transcript from ${transcription.provider}.`,
    };
  }
  const style = (await loadStyleReference()) ?? undefined;

  try {
    const result = await draftP2Update(runtime, {
      transcript,
      project,
      call: { recording_id: recordingId, url },
      style,
      extra_context: extraContext,
      user_intent: intent?.trim() || undefined,
    });
    return { ok: true, data: result.output };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Agent call failed",
    };
  }
}

/**
 * Compose a recap message to send to the partner right after the
 * call. Different from compose-followup-nudge (which nudges someone
 * who didn't reply) — this is the proactive after-call confirmation.
 */
export async function composeCallRecapAction(
  slug: string,
  recordingId: string,
  url?: string,
  extraContext?: ContextItem[],
  intent?: string,
): Promise<
  | { ok: true; data: ComposeCallRecapOutput }
  | {
      ok: false;
      reason: "not-configured" | "transcript-missing" | "error";
      message?: string;
    }
> {
  if (!slug) throw new Error("slug is required");
  if (!recordingId) throw new Error("recordingId is required");

  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const vault = await getVault();
  const project = await vault.readProject(slug);
  if (!project) return { ok: false, reason: "error", message: "Project not found" };

  const mcp = await getMcpClient();
  const transcription = await getTranscriptionAdapter();
  const transcript = await transcription
    .fetchTranscript({ recording_id: recordingId, url })
    .catch(() => null);
  if (!transcript) {
    return {
      ok: false,
      reason: "transcript-missing",
      message: `Couldn't fetch the transcript from ${transcription.provider}.`,
    };
  }
  const style = (await loadStyleReference()) ?? undefined;

  try {
    const result = await composeCallRecap(runtime, {
      transcript,
      project,
      call: { recording_id: recordingId, url },
      style,
      extra_context: extraContext,
      user_intent: intent?.trim() || undefined,
    });
    return { ok: true, data: result.output };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Agent call failed",
    };
  }
}

/**
 * Append a batch of action items from a call analysis to the project's
 * Open Items as `- [ ] <text>` lines. Tags items with the action's
 * owner (when known) so the user can scan whose commitments they're
 * tracking.
 */
export async function acceptCallActionItemsAction(
  slug: string,
  items: CallActionItem[],
): Promise<{ added: number }> {
  if (!slug) throw new Error("slug is required");
  if (items.length === 0) return { added: 0 };
  const vault = await getVault();
  let added = 0;
  for (const item of items) {
    const text = item.text.trim();
    if (!text) continue;
    const ownerSuffix =
      item.owner && item.owner !== "unknown" ? ` _(${item.owner})_` : "";
    const markers =
      item.priority || item.due_date
        ? { priority: item.priority, due_date: item.due_date }
        : undefined;
    try {
      await vault.appendProjectTask(slug, `${text}${ownerSuffix}`, markers);
      added += 1;
    } catch {
      // Continue with the rest if any single append fails.
    }
  }
  revalidatePath(`/projects/${slug}`);
  return { added };
}

/**
 * Append a batch of call-derived decisions to the project body's
 * `## Decisions` section as a per-call sub-block AND mirror them as a
 * single entry in the project log (notes.md). The body section keeps
 * a durable record indexed by call; the log entry is what shows on
 * the workbench's Project Log panel — without that second write,
 * decisions are invisible on the page because the panel reads only
 * from notes.md + Linear updates, not from the body.
 *
 * Vault-only projects (no HM) get the body write only — they don't
 * have a notes.md surface yet.
 */
export async function acceptCallDecisionsAction(
  slug: string,
  decisions: CallDecision[],
  callTitle: string,
  callDate: string,
  callUrl?: string,
): Promise<{ added: number }> {
  if (!slug) throw new Error("slug is required");
  if (decisions.length === 0) return { added: 0 };
  const vault = await getVault();
  const project = await vault.readProject(slug);
  if (!project) throw new Error(`Project "${slug}" not found`);

  let bodyAdded = 0;
  // Vault-side body write is HM-incompatible (the helper throws for
  // HM-kind projects). Only run it for vault-source projects.
  if (project.source.kind !== "hive-mind") {
    try {
      const result = await vault.appendDecisionsToProject(slug, {
        call_title: callTitle,
        call_date: callDate,
        call_url: callUrl,
        decisions,
      });
      if (result.changed) bodyAdded = decisions.length;
    } catch {
      // Non-fatal — the project-log mirror below still lets the user
      // see the decisions on the workbench.
    }
  }

  // Mirror to the project log via HM notes.md (the panel's data
  // source). One entry summarising all decisions from the call so the
  // log isn't spammed with N rows per call.
  if (project.hive_mind_partner_slug) {
    const hmPartner = project.hive_mind_partner_slug;
    const hmProject = project.hive_mind_project_slug ?? project.slug;
    const date = (callDate ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    const heading = callUrl
      ? `Decisions from [${callTitle}](${callUrl})`
      : `Decisions from ${callTitle}`;
    const body = decisions
      .map((d) => {
        const main = `- ${d.text.trim()}`;
        return d.context?.trim() ? `${main}\n  *${d.context.trim()}*` : main;
      })
      .join("\n");
    try {
      const mcp = await getMcpClient();
      await mcp.hiveMind.addProjectNote(hmPartner, hmProject, date, heading, body);
      await mcp.hiveMind.commit(
        `notes: decisions from "${callTitle}" for ${hmPartner}/${hmProject}`,
      );
    } catch {
      // Non-fatal — body section is still the durable record.
    }
  }

  revalidatePath(`/projects/${slug}`);
  return { added: Math.max(bodyAdded, decisions.length) };
}

/**
 * Append a batch of call-derived follow-ups to Follow-ups.md. Project
 * column is taken from the workbench's project name so the matcher
 * picks them up. Source column links back to the recording when a
 * URL was passed. Dual-writes to HM follow-ups.md when the project
 * is HM-connected so the workbench (which prefers HM follow-ups when
 * connected) actually surfaces them.
 */
export async function acceptCallFollowUpsAction(
  slug: string,
  items: CallFollowUp[],
  callUrl?: string,
): Promise<{ added: number }> {
  if (!slug) throw new Error("slug is required");
  if (items.length === 0) return { added: 0 };
  const vault = await getVault();
  const project = await vault.readProject(slug);
  if (!project) throw new Error(`Project "${slug}" not found`);

  const sent = new Date().toISOString().slice(0, 10);
  const source = callUrl ? `[call](${callUrl})` : "";

  let added = 0;
  for (const item of items) {
    const task = item.task.trim();
    if (!task) continue;
    try {
      await vault.appendFollowUp({
        project: project.name,
        task,
        sent,
        follow_up_by: item.follow_up_by,
        source,
      });
      added += 1;
    } catch {
      // Skip any single failure — keep adding the rest.
    }
  }
  revalidatePath(`/projects/${slug}`);

  // Mirror the vault Follow-ups.md state to HM follow-ups.md so the
  // workbench (which reads HM when connected) reflects the new rows.
  // Mirrors createLinkedFollowUpAction's dual-write path.
  if (project.hive_mind_partner_slug) {
    const hmPartner = project.hive_mind_partner_slug;
    const hmProject = project.hive_mind_project_slug ?? project.slug;
    try {
      const mcp = await getMcpClient();
      await syncFollowUpsToHiveMind(
        vault,
        mcp,
        slug,
        project.name,
        hmPartner,
        hmProject,
      );
    } catch {
      // Non-fatal — vault is the source of truth.
    }
  }

  return { added };
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
 * Mark a Fathom recording as "not this project" — appends the
 * recording_id to fathom_excluded_recording_ids in frontmatter so the
 * shared recordingMatchesProject helper hides it from this project on
 * future renders. Used when fuzzy token matching surfaces a call on the
 * wrong workbench. Idempotent.
 */
export async function detachRecordingFromProjectAction(
  slug: string,
  recordingId: string,
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: string }> {
  if (!slug) return { ok: false, reason: "slug is required" };
  if (!recordingId) return { ok: false, reason: "recordingId is required" };
  const vault = await getVault();
  try {
    const result = await vault.addFathomExcludedRecordingId(slug, recordingId);
    revalidatePath(`/projects/${slug}`);
    revalidatePath("/calls");
    revalidatePath("/today");
    return { ok: true, changed: result.changed };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed",
    };
  }
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
  if (!followUpId) throw new Error("followUpId is required");

  const vault = await getVault();
  const result = await vault.resolveFollowUp(followUpId, note);

  revalidatePath("/follow-ups");
  if (slug) revalidatePath(`/projects/${slug}`);

  // Dual-write: sync follow-ups.md in Hive Mind when the project is
  // connected. Empty slug → /follow-ups call, skip dual-write (the
  // global page doesn't know which project the row belonged to;
  // the next render will pull fresh state from vault anyway).
  if (slug) {
    const proj = await vault.readProject(slug).catch(() => null);
    if (proj?.hive_mind_partner_slug) {
      const hmPartner = proj.hive_mind_partner_slug;
      const hmProject = proj.hive_mind_project_slug ?? proj.slug;
      try {
        const mcp = await getMcpClient();
        await syncFollowUpsToHiveMind(vault, mcp, slug, proj.name, hmPartner, hmProject);
      } catch {
        // Non-fatal.
      }
    }
  }

  return { changed: result.changed };
}

/**
 * Push a follow-up's `Follow-up By` cell forward by N days without
 * marking it resolved. Used by the "Snooze" affordance on the workbench
 * — partner says "ping me next week", thread needs more time. The
 * client picks the offset (3d / 1w / 2w); the server computes the new
 * date relative to today so the user doesn't have to.
 */
export async function snoozeFollowUpAction(
  slug: string,
  followUpId: string,
  days: number,
): Promise<{ changed: boolean; follow_up_by: string }> {
  if (!followUpId) throw new Error("followUpId is required");
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("days must be a positive number");
  }

  const target = new Date();
  target.setUTCDate(target.getUTCDate() + Math.round(days));
  const newFollowUpBy = target.toISOString().slice(0, 10);

  const vault = await getVault();
  const result = await vault.snoozeFollowUp(followUpId, newFollowUpBy);

  if (slug) revalidatePath(`/projects/${slug}`);
  revalidatePath("/follow-ups");
  return { changed: result.changed, follow_up_by: result.follow_up_by };
}

/**
 * Append a follow-up row with source linkage (source_type + source_ref).
 * Used by the "Watch for reply" dialog on Zendesk and GitHub rows so the
 * follow-up can be cross-referenced back to the originating ticket/issue.
 */
export async function createLinkedFollowUpAction(
  projectSlug: string,
  input: import("@smithers/vault").AppendFollowUpInput,
): Promise<
  | { ok: true; follow_up_id: string }
  | { ok: false; reason: "error"; message?: string }
> {
  if (!projectSlug) throw new Error("projectSlug is required");
  if (!input.task?.trim()) throw new Error("task is required");
  if (!input.project?.trim()) throw new Error("project is required");

  try {
    const vault = await getVault();
    const result = await vault.appendFollowUp(input);
    revalidatePath(`/projects/${projectSlug}`);

    // Dual-write: sync follow-ups.md in Hive Mind when connected.
    const proj = await vault.readProject(projectSlug).catch(() => null);
    if (proj?.hive_mind_partner_slug) {
      const hmPartner = proj.hive_mind_partner_slug;
      const hmProject = proj.hive_mind_project_slug ?? proj.slug;
      try {
        const mcp = await getMcpClient();
        await syncFollowUpsToHiveMind(vault, mcp, projectSlug, proj.name, hmPartner, hmProject);
      } catch {
        // Non-fatal.
      }
    }

    return { ok: true, follow_up_id: result.follow_up_id };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Failed to create follow-up",
    };
  }
}

/**
 * Multi-turn conversational Q&A about a call transcript. Sends the full
 * transcript + conversation history + new user message to Claude and
 * returns the assistant's reply as plain text. The transcript never
 * leaves the server; only the reply is returned to the client.
 */
export async function chatAboutCallAction(
  _projectSlug: string,
  transcript: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
): Promise<{ ok: true; reply: string } | { ok: false; message: string }> {
  if (!transcript) return { ok: false, message: "No transcript available" };
  if (!userMessage.trim()) return { ok: false, message: "Message is empty" };

  const runtime = await getAgentRuntime();
  if (!runtime) {
    return {
      ok: false,
      message: "Set ANTHROPIC_API_KEY in .env.local to enable chat",
    };
  }

  try {
    const reply = await chatAboutTranscript(runtime, {
      transcript,
      history: messages,
      userMessage,
    });
    return { ok: true, reply };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Chat request failed",
    };
  }
}

/**
 * Convert an active follow-up back into a project task. Resolves the
 * follow-up (marks it done) and appends a fresh `- [ ]` checkbox to the
 * project body with the follow-up's task text.
 *
 * Returns discriminated result. On success, call router.refresh().
 */
export async function convertFollowUpToTaskAction(
  projectSlug: string,
  followUpId: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: "not-found" | "error"; message?: string }
> {
  if (!projectSlug) throw new Error("projectSlug is required");
  if (!followUpId) throw new Error("followUpId is required");

  const vault = await getVault();
  const project = await vault.readProject(projectSlug);
  if (!project) return { ok: false, reason: "not-found", message: "Project not found" };

  const followUps = await vault.listFollowUps().catch(() => ({
    active: [] as Awaited<ReturnType<typeof vault.listFollowUps>>["active"],
    resolved: [] as Awaited<ReturnType<typeof vault.listFollowUps>>["resolved"],
  }));
  const followUp = [...followUps.active, ...followUps.resolved].find(
    (f) => f.follow_up_id === followUpId,
  );
  if (!followUp) {
    return {
      ok: false,
      reason: "not-found",
      message: `Follow-up ${followUpId} not found`,
    };
  }

  try {
    await vault.resolveFollowUp(followUpId, "converted to task");
    await vault.appendProjectTask(projectSlug, followUp.task);
    revalidatePath(`/projects/${projectSlug}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Conversion failed",
    };
  }
}

/**
 * Update editable fields on a follow-up row in Follow-ups.md. Used by the
 * inline edit form on the /follow-ups page. Patch semantics: undefined
 * leaves the cell alone; empty string clears it.
 */
/**
 * Remove a follow-up row from Follow-ups.md entirely. Used for entries
 * the user added by mistake (vs. resolve, which keeps the audit trail
 * with a ✅ status). Empty slug is fine when called from /follow-ups
 * — the action revalidates the global page and skips the project
 * revalidation.
 */
export async function deleteFollowUpAction(
  projectSlug: string,
  followUpId: string,
): Promise<{ ok: true; deleted: boolean } | { ok: false; reason: "error"; message?: string }> {
  if (!followUpId) throw new Error("followUpId is required");
  try {
    const vault = await getVault();
    const result = await vault.deleteFollowUp(followUpId);

    revalidatePath("/follow-ups");
    if (projectSlug) revalidatePath(`/projects/${projectSlug}`);

    // Dual-write follow-ups.md in Hive Mind when the project is
    // connected, so the removed row disappears from HM too.
    if (projectSlug) {
      const proj = await vault.readProject(projectSlug).catch(() => null);
      if (proj?.hive_mind_partner_slug) {
        const hmPartner = proj.hive_mind_partner_slug;
        const hmProject = proj.hive_mind_project_slug ?? proj.slug;
        try {
          const mcp = await getMcpClient();
          await syncFollowUpsToHiveMind(
            vault,
            mcp,
            projectSlug,
            proj.name,
            hmPartner,
            hmProject,
          );
        } catch {
          /* HM sync is non-fatal */
        }
      }
    }

    return { ok: true, deleted: result.deleted };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function updateFollowUpAction(
  _projectSlug: string,
  followUpId: string,
  patch: UpdateFollowUpPatch,
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: "not-found" | "error"; message?: string }> {
  if (!followUpId) throw new Error("followUpId is required");

  try {
    const vault = await getVault();
    const result = await vault.updateFollowUp(followUpId, patch);
    // Revalidate both the global follow-ups page and any project page.
    revalidatePath("/follow-ups");
    if (_projectSlug) revalidatePath(`/projects/${_projectSlug}`);
    return { ok: true, changed: result.changed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      return { ok: false, reason: "not-found", message: msg };
    }
    return { ok: false, reason: "error", message: msg };
  }
}

/**
 * Append the full chat conversation as a `## Chat` section to the
 * Call Notes file for the given recording. If no notes file exists yet
 * for this recording, the action is a no-op (returns changed: false).
 */
export async function saveChatToCallNotesAction(
  _projectSlug: string,
  recordingId: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ ok: true; changed: boolean } | { ok: false; message: string }> {
  if (!recordingId) return { ok: false, message: "recordingId is required" };
  if (messages.length === 0) return { ok: false, message: "No messages to save" };

  try {
    const vault = await getVault();
    const result = await vault.appendChatToCallNotes(recordingId, messages);
    return { ok: true, changed: result.changed };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Couldn't save chat",
    };
  }
}

/**
 * Append a dated note to the Hive Mind project notes file. Requires the
 * project to have `hive_mind_partner_slug` set; returns `not-configured`
 * when it doesn't so the UI can show a setup CTA instead of an error.
 */
export async function addProjectLogNoteAction(
  slug: string,
  heading: string,
  body: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!slug) throw new Error("slug is required");
  const trimmedHeading = heading.trim();
  const trimmedBody = body.trim();
  if (!trimmedHeading) throw new Error("heading is required");
  if (!trimmedBody) throw new Error("body is required");

  const vault = await getVault();
  const project = await vault.readProject(slug);
  if (!project) return { ok: false, reason: "Project not found" };

  if (!project.hive_mind_partner_slug) {
    return { ok: false, reason: "not-configured" };
  }

  const hmPartnerSlug = project.hive_mind_partner_slug;
  const hmProjectSlug = project.hive_mind_project_slug ?? project.slug;
  const todayISO = new Date().toISOString().slice(0, 10);

  const mcp = await getMcpClient();
  try {
    await mcp.hiveMind.addProjectNote(
      hmPartnerSlug,
      hmProjectSlug,
      todayISO,
      trimmedHeading,
      trimmedBody,
    );
    await mcp.hiveMind.commit(
      `notes: add project log entry for ${hmPartnerSlug}/${hmProjectSlug}`,
    );
    revalidatePath(`/projects/${slug}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to add note",
    };
  }
}

// --- Pinned context (Phase H) ----------------------------------------------

/**
 * Fetch the latest partner-side message on a Zendesk ticket so the
 * Draft reply picker can surface it before the user composes their
 * extra context. Returns null when the ticket has no recent activity
 * or the upstream call fails. Best-effort — the existing draft action
 * has the same fetch and falls back to a subject-only prompt when
 * comments aren't reachable.
 */
export async function fetchZendeskLatestPartnerActivityAction(
  slug: string,
  ticketId: string,
): Promise<
  | { ok: true; excerpt: string; timestamp: string }
  | { ok: false; reason: string }
> {
  if (!slug || !ticketId) {
    return { ok: false, reason: "slug and ticketId are required" };
  }
  const mcp = await getMcpClient();
  const recent = await mcp.contextA8C
    .fetchZendeskTicketActivity(ticketId, { projectSlug: slug, limit: 10 })
    .catch(() => []);
  const lastPartner = recent.find((e) => e.actor?.is_external === true);
  if (!lastPartner?.excerpt) {
    return { ok: false, reason: "No partner activity available." };
  }
  return {
    ok: true,
    excerpt: lastPartner.excerpt,
    timestamp: lastPartner.timestamp ?? "",
  };
}

/**
 * Look up the Hive-Mind partner/project slug pair for a Smithers
 * project. Used by the draft context picker when resolving a
 * call-transcript suggestion at Generate time. Returns null when
 * the project isn't HM-connected.
 */
export async function getProjectHiveMindSlugsAction(
  slug: string,
): Promise<{ partnerSlug: string; projectSlug: string } | null> {
  if (!slug) return null;
  const vault = await getVault();
  const project = await vault.readProject(slug).catch(() => null);
  if (!project?.hive_mind_partner_slug) return null;
  return {
    partnerSlug: project.hive_mind_partner_slug,
    projectSlug: project.hive_mind_project_slug ?? project.slug,
  };
}

/**
 * Phase H5 suggestion engine. Pulls the project's recent (≤7d) activity
 * from `listProjectActivity` plus any Hive-Mind call transcripts, drops
 * anything already pinned, sorts by timestamp desc, and returns up to
 * five candidates the picker can offer the user. Bodies are NOT fetched
 * here — the picker resolves them at Generate time so we don't pay for
 * fetches the user might toggle off.
 */
export async function getDraftContextSuggestionsAction(
  slug: string,
  opts?: {
    /** Zendesk ticket id currently being replied to — exclude from suggestions. */
    excludeZendeskTicketId?: string;
  },
): Promise<{ rows: DraftContextSuggestion[] }> {
  if (!slug) return { rows: [] };

  const vault = await getVault();
  const project = await vault.readProject(slug).catch(() => null);
  if (!project) return { rows: [] };

  // Already-pinned refs — exclude from suggestions so we don't double up.
  const pinnedRefs = new Set<string>();
  if (project.hive_mind_partner_slug) {
    const pinned = await vault
      .getHiveMindPinnedContext(
        project.hive_mind_partner_slug,
        project.hive_mind_project_slug ?? project.slug,
      )
      .catch(() => null);
    for (const row of pinned?.rows ?? []) pinnedRefs.add(row.ref);
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const mcp = await getMcpClient();
  const activityResult = await mcp.contextA8C
    .listProjectActivity({
      project_slug: project.slug,
      project_name: project.name,
      limit: 30,
      since: sevenDaysAgo,
      refs: {
        github_repo: project.github_repo,
        linear_project_id: project.linear_project_id,
        linear_project_slug: project.linear_project_slug,
        zendesk_tickets: project.zendesk_tickets?.map((t) => t.id),
        slack_channel: project.slack_channel,
        partner: project.partner,
      },
    })
    .catch(() => null);

  const events = activityResult?.ok
    ? activityResult.data
    : (activityResult?.cachedData ?? []);

  const candidates: DraftContextSuggestion[] = [];

  for (const event of events) {
    const mapped = mapActivityEventToSuggestion(event, opts?.excludeZendeskTicketId);
    if (!mapped) continue;
    if (pinnedRefs.has(mapped.ref)) continue;
    candidates.push(mapped);
  }

  // Hive-Mind call transcripts. Their ref is the project-relative path
  // (call-transcripts/<file>.md) — same shape pinned-context.md uses.
  if (project.hive_mind_partner_slug) {
    const hmPartner = project.hive_mind_partner_slug;
    const hmProject = project.hive_mind_project_slug ?? project.slug;
    const transcripts = await vault
      .getHiveMindCallTranscripts(hmPartner, hmProject)
      .catch(() => []);
    for (const t of transcripts) {
      const ref = `call-transcripts/${t.filename}`;
      if (pinnedRefs.has(ref)) continue;
      const ts = t.frontmatter.date
        ? new Date(`${t.frontmatter.date}T00:00:00Z`).toISOString()
        : "";
      // Drop transcripts older than the 7-day window so the suggestion
      // section stays "what just happened" rather than "what's on file".
      if (ts && ts < sevenDaysAgo) continue;
      candidates.push({
        type: "call-transcript",
        ref,
        label: t.frontmatter.title ?? t.filename.replace(/\.md$/i, ""),
        sourceLabel: "Call",
        timestamp: ts,
      });
    }
  }

  candidates.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return { rows: candidates.slice(0, 5) };
}

export interface DraftContextSuggestion {
  type:
    | "slack-thread"
    | "slack-message"
    | "github-issue-comment"
    | "call-transcript"
    | "zendesk-ticket"
    | "linear-issue";
  /** Stable ref — URL for slack/github/linear/zendesk; vault relative path for call-transcript. */
  ref: string;
  label: string;
  /** Short source label shown next to the badge — e.g. "Slack #channel", "GitHub", "Call". */
  sourceLabel: string;
  /** ISO timestamp of the underlying event (drives recency sort). */
  timestamp: string;
}

/**
 * Read the project's pinned-context.md rows. Returns an empty array
 * (not null) when nothing is pinned or Hive-Mind isn't configured —
 * the picker UI treats both as "no pins yet".
 */
export async function listPinnedContextAction(
  slug: string,
): Promise<{ rows: HiveMindPinnedContextRow[] }> {
  if (!slug) return { rows: [] };
  const vault = await getVault();
  const project = await vault.readProject(slug).catch(() => null);
  if (!project?.hive_mind_partner_slug) return { rows: [] };
  const data = await vault
    .getHiveMindPinnedContext(
      project.hive_mind_partner_slug,
      project.hive_mind_project_slug ?? project.slug,
    )
    .catch(() => null);
  return { rows: data?.rows ?? [] };
}

/**
 * Pin a context item to the project's pinned-context.md in Hive-Mind.
 * Idempotent — duplicates by `ref` are silently skipped. The body of the
 * resolved item is intentionally NOT persisted; pins only carry the ref
 * + label + type + added date. The body is re-fetched by the picker /
 * agent at use time so stale Slack threads / GitHub comments don't get
 * sent to draft agents.
 */
export async function pinContextAction(
  slug: string,
  item: Pick<ContextItem, "type" | "ref" | "label">,
): Promise<{ ok: true; total: number } | { ok: false; reason: string }> {
  if (!slug) return { ok: false, reason: "slug is required" };
  if (!item.ref.trim()) return { ok: false, reason: "ref is required" };

  const vault = await getVault();
  const project = await vault.readProject(slug).catch(() => null);
  if (!project) return { ok: false, reason: "Project not found" };
  if (!project.hive_mind_partner_slug) {
    return { ok: false, reason: "not-configured" };
  }
  const hmPartner = project.hive_mind_partner_slug;
  const hmProject = project.hive_mind_project_slug ?? project.slug;

  const existing = await vault
    .getHiveMindPinnedContext(hmPartner, hmProject)
    .catch(() => null);
  const today = new Date().toISOString().slice(0, 10);

  const existingRows: HiveMindPinnedContextRow[] = existing?.rows ?? [];
  if (existingRows.some((r) => r.ref === item.ref)) {
    return { ok: true, total: existingRows.length };
  }
  const nextRows: HiveMindPinnedContextRow[] = [
    ...existingRows,
    { type: item.type, ref: item.ref, label: item.label, added: today },
  ];

  const content = serializeHiveMindPinnedContext({
    partnerSlug: hmPartner,
    projectSlug: hmProject,
    projectTitle: project.name,
    rows: nextRows,
    updated: today,
  });

  try {
    const mcp = await getMcpClient();
    await mcp.hiveMind.writeProjectFile(hmPartner, hmProject, "pinned-context.md", content);
    await mcp.hiveMind.commit(`pinned-context: pin ${item.type} for ${hmPartner}/${hmProject}`);
    revalidatePath(`/projects/${slug}`);
    return { ok: true, total: nextRows.length };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to pin",
    };
  }
}

/**
 * Remove a pinned context item by ref. Returns `not-found` when the ref
 * doesn't match anything.
 */
export async function unpinContextAction(
  slug: string,
  ref: string,
): Promise<{ ok: true; total: number } | { ok: false; reason: string }> {
  if (!slug) return { ok: false, reason: "slug is required" };
  if (!ref.trim()) return { ok: false, reason: "ref is required" };

  const vault = await getVault();
  const project = await vault.readProject(slug).catch(() => null);
  if (!project) return { ok: false, reason: "Project not found" };
  if (!project.hive_mind_partner_slug) {
    return { ok: false, reason: "not-configured" };
  }
  const hmPartner = project.hive_mind_partner_slug;
  const hmProject = project.hive_mind_project_slug ?? project.slug;

  const existing = await vault
    .getHiveMindPinnedContext(hmPartner, hmProject)
    .catch(() => null);
  const existingRows: HiveMindPinnedContextRow[] = existing?.rows ?? [];
  const nextRows = existingRows.filter((r) => r.ref !== ref);
  if (nextRows.length === existingRows.length) {
    return { ok: false, reason: "not-found" };
  }
  const today = new Date().toISOString().slice(0, 10);
  const content = serializeHiveMindPinnedContext({
    partnerSlug: hmPartner,
    projectSlug: hmProject,
    projectTitle: project.name,
    rows: nextRows,
    updated: today,
  });

  try {
    const mcp = await getMcpClient();
    await mcp.hiveMind.writeProjectFile(hmPartner, hmProject, "pinned-context.md", content);
    await mcp.hiveMind.commit(`pinned-context: unpin for ${hmPartner}/${hmProject}`);
    revalidatePath(`/projects/${slug}`);
    return { ok: true, total: nextRows.length };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to unpin",
    };
  }
}

// --- internals ---

/**
 * Map a `ContextA8C.listProjectActivity` event to a `DraftContextSuggestion`
 * the picker can show. Returns null when the event lacks a usable ref or
 * matches the excluded Zendesk ticket. Slack messages get classified as
 * "slack-thread" when the URL hints at a thread (has a `thread_ts` or
 * permalink path), else "slack-message".
 */
function mapActivityEventToSuggestion(
  event: import("@smithers/mcp-client").ActivityEvent,
  excludeZendeskTicketId?: string,
): DraftContextSuggestion | null {
  const ts = event.timestamp;
  const url = event.url ?? "";
  const labelFromTitleOrExcerpt =
    event.title?.trim() || (event.excerpt ? event.excerpt.slice(0, 60) : "");

  if (event.source === "slack") {
    if (!url) return null;
    // Slack permalinks for thread replies include `?thread_ts=` (or the
    // canonical thread URL form). Treat anything else as a top-level message.
    const isThread = /thread_ts=/i.test(url);
    return {
      type: isThread ? "slack-thread" : "slack-message",
      ref: url,
      label: labelFromTitleOrExcerpt || "Slack message",
      sourceLabel: event.excerpt?.startsWith("#")
        ? `Slack ${event.excerpt}`
        : "Slack",
      timestamp: ts,
    };
  }

  if (event.source === "github") {
    if (!url) return null;
    return {
      type: "github-issue-comment",
      ref: url,
      label: labelFromTitleOrExcerpt || url,
      sourceLabel: "GitHub",
      timestamp: ts,
    };
  }

  if (event.source === "linear") {
    if (!url) return null;
    return {
      type: "linear-issue",
      ref: url,
      label: labelFromTitleOrExcerpt || url,
      sourceLabel: "Linear",
      timestamp: ts,
    };
  }

  if (event.source === "zendesk" && event.kind === "zendesk-comment") {
    // Pull the ticket id from the event id (`zendesk:<ticketId>:<commentId>`)
    // first, then fall back to URL parsing.
    const idMatch = /^zendesk:(\d+):/.exec(event.id);
    const urlMatch = /\/tickets\/(\d+)/.exec(url);
    const ticketId = idMatch?.[1] ?? urlMatch?.[1] ?? "";
    if (!ticketId) return null;
    if (excludeZendeskTicketId && ticketId === excludeZendeskTicketId) {
      return null;
    }
    const ref = url || `https://automattic.zendesk.com/agent/tickets/${ticketId}`;
    return {
      type: "zendesk-ticket",
      ref,
      label: labelFromTitleOrExcerpt || `Zendesk #${ticketId}`,
      sourceLabel: `Zendesk #${ticketId}`,
      timestamp: ts,
    };
  }

  return null;
}

function serializeHMZendesk(args: {
  search_terms: string[];
  last_refreshed: string;
  tickets: { ticket_id: number; subject: string; status: string; url: string }[];
}): string {
  const terms = args.search_terms.length
    ? args.search_terms.map((t) => `  - "${t}"`).join("\n")
    : "";
  const fm = [
    "---",
    `search_terms:`,
    terms || "  []",
    `last_refreshed: ${args.last_refreshed}`,
    "---",
  ].join("\n");
  const header = "| ticket_id | subject | status | url |";
  const sep = "| :-- | :-- | :-- | :-- |";
  const rows = args.tickets.map(
    (t) => `| ${t.ticket_id} | ${t.subject} | ${t.status} | ${t.url} |`,
  );
  return [fm, "", header, sep, ...rows, ""].join("\n");
}

async function syncFollowUpsToHiveMind(
  vault: Awaited<ReturnType<typeof getVault>>,
  mcp: Awaited<ReturnType<typeof getMcpClient>>,
  projectSlug: string,
  projectName: string,
  hmPartner: string,
  hmProject: string,
): Promise<void> {
  const allFollowUps = await vault.listFollowUps().catch(() => ({ active: [], resolved: [] }));
  const projectActive = filterFollowUpsForProject(allFollowUps.active, { name: projectName, slug: projectSlug, partner: undefined });
  const projectResolved = filterFollowUpsForProject(allFollowUps.resolved, { name: projectName, slug: projectSlug, partner: undefined });

  const header = "| id | task | sent_to | sent_date | follow_by | source_type | source_ref | status |";
  const sep = "| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |";
  const toRow = (f: import("@smithers/vault").FollowUp, status: string) =>
    `| ${f.follow_up_id} | ${f.task.replace(/\|/g, "\\|")} | ${projectName} | ${f.sent ?? ""} | ${f.follow_up_by ?? ""} | ${f.source_type ?? ""} | ${f.source_ref ?? ""} | ${status} |`;

  const rows = [
    ...projectActive.map((f) => toRow(f, "active")),
    ...projectResolved.map((f) => toRow(f, "resolved")),
  ];

  const content = [header, sep, ...rows, ""].join("\n");
  await mcp.hiveMind.writeProjectFile(hmPartner, hmProject, "follow-ups.md", content);
  await mcp.hiveMind.commit(`follow-ups: sync for ${hmPartner}/${hmProject}`);
}

function buildCallTranscriptFile(args: {
  title: string;
  partnerSlug: string;
  projectSlug: string;
  date: string;
  recordingUrl: string | null;
  transcriptionService: string;
  updated: string;
  transcript: string;
  analysis: AnalyzeCallTranscriptOutput;
}): string {
  const recordingUrlYaml = args.recordingUrl
    ? `"${args.recordingUrl}"`
    : "null";

  const actionItemsBlock = args.analysis.action_items.length
    ? args.analysis.action_items
        .map((a) => `- ${a.text}${a.owner ? ` (${a.owner})` : ""}`)
        .join("\n")
    : "_None identified._";

  const decisionsBlock = args.analysis.decisions.length
    ? args.analysis.decisions
        .map((d) => `- ${d.text}${d.context ? ` — ${d.context}` : ""}`)
        .join("\n")
    : "_None identified._";

  const keyQuotesBlock = args.analysis.key_quotes.length
    ? args.analysis.key_quotes
        .map((q) => `> "${q.text}" — ${q.speaker}`)
        .join("\n\n")
    : "_None captured._";

  return `---
title: "${args.title.replace(/"/g, '\\"')}"
partner: "${args.partnerSlug}"
project: "${args.projectSlug}"
date: ${args.date}
attendees: []
recording_url: ${recordingUrlYaml}
transcription_service: ${args.transcriptionService}
updated: ${args.updated}
---

## Transcript

${args.transcript.trim()}

## Analysis

### Summary

${args.analysis.summary}

### To-Dos

${actionItemsBlock}

### Decisions

${decisionsBlock}

### Key Quotes

${keyQuotesBlock}
`;
}

// ---------------------------------------------------------------------------
// Brief generation — runs the /create-brief Hive Mind skill from the workbench.
// ---------------------------------------------------------------------------

export interface GenerateBriefInput {
  /** Vault project slug. */
  slug: string;
  /** HM-root-relative paths of transcripts to include. */
  transcript_paths: string[];
  /** Discovery Doc — URL or pasted content. */
  discovery_doc: { kind: "url" | "content"; value: string };
  /** Domain registrar (e.g. "Squarespace Domains"). */
  domain_registrar: string;
  /** DNS provider; can be the same as registrar. */
  dns_provider: string;
}

export type GenerateBriefResult =
  | { ok: true; data: RunSkillOutput }
  | { ok: false; reason: "not-configured" | "skill-missing" | "no-sources" | "error"; message?: string };

/**
 * Run the create-brief skill from the workbench. Loads the skill's
 * SKILL.md + declared dependency files from HM, gathers project /
 * partner context + the inputs above, calls the run-skill agent.
 *
 * Does NOT write the brief to disk — that happens in
 * saveProjectBriefAction after the user reviews. Persists the
 * inputs to HM frontmatter (discovery_doc_url + registrar/dns) on
 * success so re-generates pre-fill correctly.
 */
export async function generateProjectBriefAction(
  input: GenerateBriefInput,
): Promise<GenerateBriefResult> {
  if (
    input.transcript_paths.length === 0 &&
    !input.discovery_doc.value.trim()
  ) {
    return { ok: false, reason: "no-sources" };
  }
  const vault = await getVault();
  const project = await vault.readProject(input.slug);
  if (!project) {
    return { ok: false, reason: "error", message: `Project "${input.slug}" not found` };
  }
  const partnerSlug = project.hive_mind_partner_slug ?? project.partner;
  const projectSlug = project.hive_mind_project_slug ?? project.slug;
  if (!partnerSlug) {
    return { ok: false, reason: "error", message: "Project is not connected to Hive Mind" };
  }

  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const cfg = await loadConfig();
  if (!cfg.paths.hive_mind) {
    return { ok: false, reason: "not-configured", message: "hive_mind path not set" };
  }

  const skillContent = await vault.getHiveMindSkillContent("create-brief");
  if (!skillContent) {
    return { ok: false, reason: "skill-missing" };
  }

  // Resolve transcript file contents.
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const transcripts: { path: string; body: string }[] = [];
  for (const rel of input.transcript_paths) {
    try {
      const abs = join(cfg.paths.hive_mind, rel);
      const body = await readFile(abs, "utf-8");
      transcripts.push({ path: rel, body });
    } catch {
      // skip missing transcripts; the agent will still get the rest
    }
  }

  const hmPartner = await vault.getHiveMindPartner(partnerSlug);
  const hmProject = await vault.getHiveMindProject(partnerSlug, projectSlug);

  const inputsMarkdown = renderBriefInputsMarkdown({
    partnerSlug,
    projectSlug,
    project,
    hmPartner,
    hmProject,
    transcripts,
    discoveryDoc: input.discovery_doc,
    registrar: input.domain_registrar,
    dns: input.dns_provider,
  });

  try {
    const result = await runHiveMindSkill(runtime, {
      skill_slug: "create-brief",
      skill_prompt: skillContent.system_prompt,
      dependency_files: skillContent.files,
      inputs_markdown: inputsMarkdown,
    });

    // Persist inputs so re-generates pre-fill correctly. Best-effort —
    // failures don't block the generated brief from coming back.
    void persistBriefInputs({
      partnerSlug,
      projectSlug,
      hiveMindPath: cfg.paths.hive_mind,
      discoveryDocUrl:
        input.discovery_doc.kind === "url" ? input.discovery_doc.value : "",
      registrar: input.domain_registrar,
      dns: input.dns_provider,
    });

    return { ok: true, data: result.output };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Brief generation failed",
    };
  }
}

/**
 * Link an existing brief (typically a Google Doc — historical TAM format)
 * to this project instead of generating a new one. Writes a minimal
 * `brief.md` to HM whose body is a one-line link and whose frontmatter
 * carries `google_doc_url` — the existing brief renderer already
 * surfaces that as an "Open in Google Docs" link, so the workbench
 * card lights up immediately.
 *
 * If a brief.md already exists, this overwrites it — caller is expected
 * to confirm. Subsequent regenerate runs would also overwrite, so this
 * is consistent with the rest of the brief lifecycle.
 */
export async function linkExternalBriefAction(input: {
  slug: string;
  google_doc_url: string;
  /** Optional one-line note shown above the link in the rendered brief body. */
  note?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const url = input.google_doc_url.trim();
  if (!url) return { ok: false, reason: "Google Doc URL is required" };
  if (!/^https?:\/\//.test(url)) {
    return { ok: false, reason: "URL must start with http:// or https://" };
  }

  const vault = await getVault();
  const project = await vault.readProject(input.slug);
  if (!project) return { ok: false, reason: "Project not found" };
  const partnerSlug = project.hive_mind_partner_slug ?? project.partner;
  const projectSlug = project.hive_mind_project_slug ?? project.slug;
  if (!partnerSlug) return { ok: false, reason: "Project is not connected to Hive Mind" };

  const frontmatter: Record<string, string> = {
    google_doc_url: url,
    linked_at: new Date().toISOString(),
  };
  const note = input.note?.trim();
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  const body = [
    "---",
    yaml,
    "---",
    "",
    "# Project Brief",
    "",
    note ? `${note}\n` : "",
    `The canonical brief lives in Google Docs: ${url}`,
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const mcp = await getMcpClient();
  try {
    await mcp.hiveMind.writeProjectFile(
      partnerSlug,
      projectSlug,
      "brief.md",
      body,
    );
    await mcp.hiveMind.commit(
      `brief: link external doc for ${partnerSlug}/${projectSlug}`,
    );
    revalidatePath(`/projects/${input.slug}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "HM write failed",
    };
  }
}

/**
 * Save the reviewed brief markdown to <HM>/knowledge/partners/<partner>/
 * <project>/brief.md (the path the /create-brief skill writes to today).
 * Commits via MCP and revalidates the workbench so the brief card
 * re-renders with the new content.
 */
export async function saveProjectBriefAction(input: {
  slug: string;
  markdown: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!input.markdown.trim()) {
    return { ok: false, reason: "Brief content is empty" };
  }
  const vault = await getVault();
  const project = await vault.readProject(input.slug);
  if (!project) return { ok: false, reason: "Project not found" };
  const partnerSlug = project.hive_mind_partner_slug ?? project.partner;
  const projectSlug = project.hive_mind_project_slug ?? project.slug;
  if (!partnerSlug) return { ok: false, reason: "Project is not connected to Hive Mind" };

  const mcp = await getMcpClient();
  try {
    await mcp.hiveMind.writeProjectFile(
      partnerSlug,
      projectSlug,
      "brief.md",
      input.markdown,
    );
    await mcp.hiveMind.commit(
      `brief: regenerate via Smithers for ${partnerSlug}/${projectSlug}`,
    );
    revalidatePath(`/projects/${input.slug}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "HM write failed",
    };
  }
}

async function persistBriefInputs(args: {
  partnerSlug: string;
  projectSlug: string;
  hiveMindPath: string;
  discoveryDocUrl: string;
  registrar: string;
  dns: string;
}): Promise<void> {
  const mcp = await getMcpClient();
  try {
    // discovery_doc_url → project info.md via the direct MCP tool.
    if (args.discoveryDocUrl.trim()) {
      await mcp.hiveMind.updateProjectInfo(args.partnerSlug, args.projectSlug, {
        discovery_doc_url: args.discoveryDocUrl.trim(),
      });
    }
    // domain_registrar + dns_provider → partner-knowledge.md frontmatter
    // via read-modify-write (no dedicated MCP tool).
    if (args.registrar.trim() || args.dns.trim()) {
      const updated = await buildPartnerKnowledgeFrontmatterUpdate(
        args.hiveMindPath,
        args.partnerSlug,
        {
          domain_registrar: args.registrar.trim() || undefined,
          dns_provider: args.dns.trim() || undefined,
        },
      );
      if (updated?.changed) {
        await mcp.hiveMind.writePartnerFile(
          args.partnerSlug,
          "partner-knowledge.md",
          updated.content,
        );
      }
    }
    await mcp.hiveMind.commit(
      `brief: persist inputs for ${args.partnerSlug}/${args.projectSlug}`,
    );
  } catch {
    // best-effort; persistence failures don't surface to the user
  }
}

function renderBriefInputsMarkdown(args: {
  partnerSlug: string;
  projectSlug: string;
  project: { name: string; partner?: string };
  hmPartner: { title?: string; description?: string; body: string } | null;
  hmProject:
    | { title?: string; description?: string; discovery_doc_url?: string; body: string }
    | null;
  transcripts: { path: string; body: string }[];
  discoveryDoc: { kind: "url" | "content"; value: string };
  registrar: string;
  dns: string;
}): string {
  const lines: string[] = [];
  lines.push(`Partner slug: \`${args.partnerSlug}\``);
  lines.push(`Project slug: \`${args.projectSlug}\``);
  lines.push("");

  lines.push("## Partner");
  if (args.hmPartner) {
    lines.push(`Title: ${args.hmPartner.title ?? args.partnerSlug}`);
    if (args.hmPartner.description) {
      lines.push(`Description: ${args.hmPartner.description}`);
    }
    if (args.hmPartner.body.trim()) {
      lines.push("Partner knowledge body:");
      lines.push("```markdown");
      lines.push(args.hmPartner.body);
      lines.push("```");
    }
  } else {
    lines.push("(no partner-knowledge.md found)");
  }
  lines.push("");

  lines.push("## Project");
  if (args.hmProject) {
    lines.push(`Title: ${args.hmProject.title ?? args.project.name}`);
    if (args.hmProject.description) {
      lines.push(`Description: ${args.hmProject.description}`);
    }
    if (args.hmProject.body.trim()) {
      lines.push("Project info body:");
      lines.push("```markdown");
      lines.push(args.hmProject.body);
      lines.push("```");
    }
  } else {
    lines.push(`Project name (from vault): ${args.project.name}`);
  }
  lines.push("");

  lines.push("## Domain");
  lines.push(`Registrar: ${args.registrar.trim() || "(not provided)"}`);
  lines.push(`DNS provider: ${args.dns.trim() || "(same as registrar or not provided)"}`);
  lines.push("");

  lines.push("## Discovery Doc");
  if (args.discoveryDoc.kind === "url" && args.discoveryDoc.value.trim()) {
    lines.push(`URL: ${args.discoveryDoc.value.trim()}`);
    lines.push("(content not fetched — refer to the URL if a body is needed)");
  } else if (args.discoveryDoc.kind === "content" && args.discoveryDoc.value.trim()) {
    lines.push("Pasted content:");
    lines.push("```markdown");
    lines.push(args.discoveryDoc.value.trim());
    lines.push("```");
  } else {
    lines.push("(none provided)");
  }
  lines.push("");

  lines.push("## Call transcripts");
  if (args.transcripts.length === 0) {
    lines.push("(none provided)");
  } else {
    for (const t of args.transcripts) {
      lines.push(`### \`${t.path}\``);
      lines.push("");
      lines.push("```markdown");
      lines.push(t.body);
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}


// Project handoff — runs the /project-handoff Hive Mind skill from the workbench.

export interface GenerateHandoffInput {
  slug: string;
  /** Phase-4 user-provided context — 4 free-form prompts the skill normally asks. */
  locally_tracked_work: string;
  upcoming_calls: string;
  critical_context: string;
  exclude: string;
  /** Phase-5 "Prepared by" line — defaults to identity.name from config. */
  prepared_by: string;
}

export type GenerateHandoffResult =
  | { ok: true; data: RunSkillOutput }
  | {
      ok: false;
      reason: "not-configured" | "skill-missing" | "error";
      message?: string;
    };

/**
 * Run the project-handoff skill from the workbench. Pre-gathers what
 * we have (vault project, HM partner-knowledge, HM project info, Linear
 * project metadata) and feeds the phase-4 user-context fields straight
 * through. The skill's MCP-side crawl phases (Linear deep crawl, P2,
 * Zendesk thread reading, GitHub repo open issues) are skipped — the
 * agent doesn't have MCP access — so questions for missing data come
 * back under `result.questions` for the user to fill in manually.
 *
 * Doesn't write to disk — saveProjectHandoffAction does that after
 * review.
 */
export async function generateProjectHandoffAction(
  input: GenerateHandoffInput,
): Promise<GenerateHandoffResult> {
  const vault = await getVault();
  const project = await vault.readProject(input.slug);
  if (!project) {
    return { ok: false, reason: "error", message: `Project "${input.slug}" not found` };
  }
  const partnerSlug = project.hive_mind_partner_slug ?? project.partner;
  const projectSlug = project.hive_mind_project_slug ?? project.slug;
  if (!partnerSlug) {
    return { ok: false, reason: "error", message: "Project is not connected to Hive Mind" };
  }

  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const cfg = await loadConfig();
  if (!cfg.paths.hive_mind) {
    return { ok: false, reason: "not-configured", message: "hive_mind path not set" };
  }

  const skillContent = await vault.getHiveMindSkillContent("project-handoff");
  if (!skillContent) {
    return { ok: false, reason: "skill-missing" };
  }

  const [hmPartner, hmProject, linearProject] = await Promise.all([
    vault.getHiveMindPartner(partnerSlug).catch(() => null),
    vault.getHiveMindProject(partnerSlug, projectSlug).catch(() => null),
    project.linear_project_id
      ? (await getMcpClient()).linear.getProject(project.linear_project_id).catch(() => null)
      : Promise.resolve(null),
  ]);

  const inputsMarkdown = renderHandoffInputsMarkdown({
    partnerSlug,
    projectSlug,
    project,
    hmPartner,
    hmProject,
    linearProject,
    preparedBy: input.prepared_by.trim() || cfg.identity.name || "TAM",
    userContext: {
      locally_tracked_work: input.locally_tracked_work,
      upcoming_calls: input.upcoming_calls,
      critical_context: input.critical_context,
      exclude: input.exclude,
    },
  });

  try {
    const result = await runHiveMindSkill(runtime, {
      skill_slug: "project-handoff",
      skill_prompt: skillContent.system_prompt,
      dependency_files: skillContent.files,
      inputs_markdown: inputsMarkdown,
    });
    return { ok: true, data: result.output };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Agent call failed",
    };
  }
}

/**
 * Write the reviewed handoff markdown to the project's HM folder at
 * `handoff-<YYYY-MM-DD>.md` (per the skill's default save path). The
 * date is computed server-side so the user can't accidentally produce
 * conflicting timestamps from different timezones.
 */
export async function saveProjectHandoffAction(input: {
  slug: string;
  markdown: string;
}): Promise<{ ok: true; relative_path: string } | { ok: false; reason: string }> {
  if (!input.markdown.trim()) {
    return { ok: false, reason: "Handoff content is empty" };
  }
  const vault = await getVault();
  const project = await vault.readProject(input.slug);
  if (!project) return { ok: false, reason: "Project not found" };
  const partnerSlug = project.hive_mind_partner_slug ?? project.partner;
  const projectSlug = project.hive_mind_project_slug ?? project.slug;
  if (!partnerSlug) return { ok: false, reason: "Project is not connected to Hive Mind" };

  const today = new Date().toISOString().slice(0, 10);
  const filename = `handoff-${today}.md`;

  const mcp = await getMcpClient();
  try {
    await mcp.hiveMind.writeProjectFile(
      partnerSlug,
      projectSlug,
      filename,
      input.markdown,
    );
    await mcp.hiveMind.commit(
      `handoff: ${filename} via Smithers for ${partnerSlug}/${projectSlug}`,
    );
    revalidatePath(`/projects/${input.slug}`);
    return {
      ok: true,
      relative_path: `knowledge/partners/${partnerSlug}/${projectSlug}/${filename}`,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "HM write failed",
    };
  }
}

function renderHandoffInputsMarkdown(args: {
  partnerSlug: string;
  projectSlug: string;
  project: { name: string; partner?: string; linear_project_id?: string; github_repo?: string; p2_url?: string };
  hmPartner: { title?: string; description?: string; body: string } | null;
  hmProject: { title?: string; description?: string; body: string } | null;
  linearProject: { name?: string; url?: string; state?: { name?: string }; lead?: { displayName?: string; name?: string } | null } | null;
  preparedBy: string;
  userContext: {
    locally_tracked_work: string;
    upcoming_calls: string;
    critical_context: string;
    exclude: string;
  };
}): string {
  const lines: string[] = [];
  lines.push(`Partner slug: \`${args.partnerSlug}\``);
  lines.push(`Project slug: \`${args.projectSlug}\``);
  lines.push(`Prepared by: ${args.preparedBy}`);
  lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  lines.push("## Project identifiers");
  if (args.project.linear_project_id) {
    const linearUrl = args.linearProject?.url ?? `https://linear.app/team51/project/${args.project.linear_project_id}`;
    lines.push(`Linear: ${linearUrl}`);
  }
  if (args.project.github_repo) lines.push(`GitHub: ${args.project.github_repo}`);
  if (args.project.p2_url) lines.push(`P2: ${args.project.p2_url}`);
  lines.push("");

  if (args.linearProject) {
    lines.push("## Linear project metadata");
    if (args.linearProject.name) lines.push(`Name: ${args.linearProject.name}`);
    if (args.linearProject.state?.name) lines.push(`State: ${args.linearProject.state.name}`);
    if (args.linearProject.lead?.displayName || args.linearProject.lead?.name) {
      lines.push(`Lead: ${args.linearProject.lead.displayName ?? args.linearProject.lead.name}`);
    }
    lines.push("");
  }

  lines.push("## Partner knowledge");
  if (args.hmPartner) {
    if (args.hmPartner.title) lines.push(`Title: ${args.hmPartner.title}`);
    if (args.hmPartner.description) lines.push(`Description: ${args.hmPartner.description}`);
    if (args.hmPartner.body.trim()) {
      lines.push("Body:");
      lines.push("```markdown");
      lines.push(args.hmPartner.body);
      lines.push("```");
    }
  } else {
    lines.push("(no partner-knowledge.md found)");
  }
  lines.push("");

  lines.push("## Project info");
  if (args.hmProject) {
    if (args.hmProject.title) lines.push(`Title: ${args.hmProject.title}`);
    if (args.hmProject.description) lines.push(`Description: ${args.hmProject.description}`);
    if (args.hmProject.body.trim()) {
      lines.push("Body:");
      lines.push("```markdown");
      lines.push(args.hmProject.body);
      lines.push("```");
    }
  } else {
    lines.push(`Project name (from vault): ${args.project.name}`);
  }
  lines.push("");

  lines.push("## User-provided context (skill phase 4)");
  lines.push("");
  lines.push("### Locally tracked work");
  lines.push(args.userContext.locally_tracked_work.trim() || "(none)");
  lines.push("");
  lines.push("### Upcoming calls / meetings");
  lines.push(args.userContext.upcoming_calls.trim() || "(none)");
  lines.push("");
  lines.push("### Critical context for the next TAM");
  lines.push(args.userContext.critical_context.trim() || "(none)");
  lines.push("");
  lines.push("### Anything to exclude");
  lines.push(args.userContext.exclude.trim() || "(none)");
  lines.push("");

  lines.push("## Note to the agent");
  lines.push(
    "Smithers pre-gathered the data above. The skill's MCP-side crawl phases (Linear deep crawl, P2 reader, Zendesk thread fetch, GitHub repo open issues) are NOT available in this run — the run-skill agent has no MCP access. Produce the report from what's provided; for any section where you'd ordinarily fetch from MCP and the data isn't already included above, list the missing dependency under `questions` so the user can fill it in or fetch it separately.",
  );

  return lines.join("\n");
}

// =====================================================================
// /create-launch-post — workbench wiring
// =====================================================================

export interface GenerateLaunchPostInput {
  slug: string;
  launch_date: string;
  site_url: string;
  p2_context: string;
  linear_context: string;
  slack_context: string;
  features: string;
  lessons: string;
}

export type GenerateLaunchPostResult =
  | { ok: true; data: RunSkillOutput }
  | {
      ok: false;
      reason: "not-configured" | "error" | "skill-missing";
      message?: string;
    };

/**
 * Run the /create-launch-post skill. Pre-gathers what we have (vault
 * project, HM partner-knowledge, HM project info, Linear project
 * metadata) and threads the TAM's pasted context (P2, Linear, Slack,
 * features, lessons) through the skill's input contract. Doesn't write
 * to disk — saveProjectLaunchPostAction does that after review, and is
 * the path that also stores the collected image binaries.
 */
export async function generateProjectLaunchPostAction(
  input: GenerateLaunchPostInput,
): Promise<GenerateLaunchPostResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.launch_date.trim())) {
    return {
      ok: false,
      reason: "error",
      message: "Launch date must be YYYY-MM-DD",
    };
  }

  const vault = await getVault();
  const project = await vault.readProject(input.slug);
  if (!project) {
    return {
      ok: false,
      reason: "error",
      message: `Project "${input.slug}" not found`,
    };
  }
  const partnerSlug = project.hive_mind_partner_slug ?? project.partner;
  const projectSlug = project.hive_mind_project_slug ?? project.slug;
  if (!partnerSlug) {
    return {
      ok: false,
      reason: "error",
      message: "Project is not connected to Hive Mind",
    };
  }

  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const cfg = await loadConfig();
  if (!cfg.paths.hive_mind) {
    return {
      ok: false,
      reason: "not-configured",
      message: "hive_mind path not set",
    };
  }

  const skillContent = await vault.getHiveMindSkillContent("create-launch-post");
  if (!skillContent) return { ok: false, reason: "skill-missing" };

  const mcp = await getMcpClient();
  const linearProjectId = project.linear_project_id;
  const p2Target = project.p2_url ? parseP2Url(project.p2_url) : null;
  const [
    hmPartner,
    hmProject,
    linearProject,
    linearIssues,
    linearUpdates,
    p2Posts,
  ] = await Promise.all([
    vault.getHiveMindPartner(partnerSlug).catch(() => null),
    vault.getHiveMindProject(partnerSlug, projectSlug).catch(() => null),
    linearProjectId
      ? mcp.linear.getProject(linearProjectId).catch(() => null)
      : Promise.resolve(null),
    linearProjectId
      ? mcp.linear.getProjectIssues(linearProjectId).catch(() => [])
      : Promise.resolve([]),
    linearProjectId
      ? mcp.linear.getProjectUpdates(linearProjectId).catch(() => [])
      : Promise.resolve([]),
    p2Target
      ? mcp.contextA8C
          .fetchP2Posts({
            site: p2Target.site,
            slugs: [p2Target.slug],
            include_comments: true,
            max_comments_per_post: 100,
          })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  // Pull full detail (incl. comments) for the most recently updated
  // issues so the agent has narrative material — Linear's project
  // issues query is title/state only. Cap at 8 to keep prompt size
  // reasonable; launch posts care about the headline deliverables,
  // not every backlog ticket.
  const TOP_ISSUE_DETAIL_COUNT = 8;
  const topIssueRefs = [...linearIssues]
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, TOP_ISSUE_DETAIL_COUNT)
    .map((i) => i.identifier);
  const linearIssueDetails = (
    await Promise.all(
      topIssueRefs.map((id) => mcp.linear.getIssue(id).catch(() => null)),
    )
  ).filter((d): d is NonNullable<typeof d> => d !== null);

  const inputsMarkdown = renderLaunchPostInputsMarkdown({
    partnerSlug,
    projectSlug,
    launchDate: input.launch_date.trim(),
    siteUrl: input.site_url.trim(),
    project,
    hmPartner,
    hmProject,
    linearProject,
    linearIssues,
    linearUpdates,
    linearIssueDetails,
    p2Posts,
    preparedBy: cfg.identity.name ?? "TAM",
    userContext: {
      p2: input.p2_context,
      linear: input.linear_context,
      slack: input.slack_context,
      features: input.features,
      lessons: input.lessons,
    },
  });

  try {
    const result = await runHiveMindSkill(runtime, {
      skill_slug: "create-launch-post",
      skill_prompt: skillContent.system_prompt,
      dependency_files: skillContent.files,
      inputs_markdown: inputsMarkdown,
    });
    return { ok: true, data: result.output };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Agent call failed",
    };
  }
}

export interface SaveLaunchPostInput {
  slug: string;
  launch_date: string;
  markdown: string;
  /** base64-encoded image bytes, keyed by their target filename in assets/. */
  images: Array<{ filename: string; base64: string }>;
}

export type SaveLaunchPostResult =
  | {
      ok: true;
      relative_path: string;
      assets_written: string[];
    }
  | { ok: false; reason: string };

/**
 * Write the reviewed launch-post markdown + any uploaded image binaries
 * into the project's HM folder. Markdown goes through the MCP
 * write-project-file tool; images bypass MCP and write directly to disk
 * (write-project-file is utf-8 only). A single commit picks up
 * everything via `git add -A`.
 */
export async function saveProjectLaunchPostAction(
  input: SaveLaunchPostInput,
): Promise<SaveLaunchPostResult> {
  if (!input.markdown.trim()) {
    return { ok: false, reason: "Launch post content is empty" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.launch_date.trim())) {
    return { ok: false, reason: "Launch date must be YYYY-MM-DD" };
  }

  const vault = await getVault();
  const project = await vault.readProject(input.slug);
  if (!project) return { ok: false, reason: "Project not found" };
  const partnerSlug = project.hive_mind_partner_slug ?? project.partner;
  const projectSlug = project.hive_mind_project_slug ?? project.slug;
  if (!partnerSlug) {
    return { ok: false, reason: "Project is not connected to Hive Mind" };
  }

  const cfg = await loadConfig();
  if (!cfg.paths.hive_mind) {
    return { ok: false, reason: "hive_mind path not set in config" };
  }

  const launchDate = input.launch_date.trim();
  const filename = `launched-${launchDate}.md`;
  const mcp = await getMcpClient();
  const assetsWritten: string[] = [];

  try {
    for (const img of input.images) {
      const bytes = Buffer.from(img.base64, "base64");
      if (bytes.length === 0) continue;
      const { relative_path } = await writeLaunchPostImage({
        hiveMindRoot: cfg.paths.hive_mind,
        partnerSlug,
        projectSlug,
        launchDate,
        filename: img.filename,
        bytes,
      });
      assetsWritten.push(relative_path);
    }

    if (input.images.length > 0) {
      const manifest = renderAssetsManifest({
        launchDate,
        filenames: input.images.map((i) => i.filename),
      });
      await mcp.hiveMind.writeProjectFile(
        partnerSlug,
        projectSlug,
        `assets/launched-${launchDate}/README.md`,
        manifest,
      );
    }

    await mcp.hiveMind.writeProjectFile(
      partnerSlug,
      projectSlug,
      filename,
      input.markdown,
    );

    const summary =
      input.images.length > 0
        ? `${filename} + ${input.images.length} image${input.images.length === 1 ? "" : "s"}`
        : filename;
    await mcp.hiveMind.commit(
      `launch post: ${summary} via Smithers for ${partnerSlug}/${projectSlug}`,
    );

    revalidatePath(`/projects/${input.slug}`);
    return {
      ok: true,
      relative_path: `knowledge/partners/${partnerSlug}/${projectSlug}/${filename}`,
      assets_written: assetsWritten,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "HM write failed",
    };
  }
}

function renderLaunchPostInputsMarkdown(args: {
  partnerSlug: string;
  projectSlug: string;
  launchDate: string;
  siteUrl: string;
  project: {
    name: string;
    partner?: string;
    linear_project_id?: string;
    github_repo?: string;
    p2_url?: string;
  };
  hmPartner: { title?: string; description?: string; body: string } | null;
  hmProject: { title?: string; description?: string; body: string } | null;
  linearProject: LinearProject | null;
  linearIssues: LinearIssue[];
  linearUpdates: LinearProjectUpdate[];
  linearIssueDetails: LinearIssueDetail[];
  p2Posts: P2Post[];
  preparedBy: string;
  userContext: {
    p2: string;
    linear: string;
    slack: string;
    features: string;
    lessons: string;
  };
}): string {
  const lines: string[] = [];
  lines.push("# Inputs");
  lines.push("");
  lines.push(`Partner slug: \`${args.partnerSlug}\``);
  lines.push(`Project slug: \`${args.projectSlug}\``);
  lines.push(`Launch date: ${args.launchDate}`);
  lines.push(`Live site URL: ${args.siteUrl || "(not provided)"}`);
  lines.push(`Prepared by: ${args.preparedBy}`);
  lines.push("");

  lines.push("## Project identifiers");
  if (args.project.linear_project_id) {
    const linearUrl =
      args.linearProject?.url ??
      `https://linear.app/team51/project/${args.project.linear_project_id}`;
    lines.push(`Linear: ${linearUrl}`);
  }
  if (args.project.github_repo) lines.push(`GitHub: ${args.project.github_repo}`);
  if (args.project.p2_url) lines.push(`P2: ${args.project.p2_url}`);
  lines.push("");

  if (args.linearProject) {
    lines.push("## Linear project metadata (pre-fetched)");
    if (args.linearProject.name) lines.push(`Name: ${args.linearProject.name}`);
    if (args.linearProject.state?.name)
      lines.push(`State: ${args.linearProject.state.name}`);
    if (
      args.linearProject.lead?.displayName ||
      args.linearProject.lead?.name
    ) {
      lines.push(
        `Lead: ${args.linearProject.lead.displayName ?? args.linearProject.lead.name}`,
      );
    }
    if (args.linearProject.targetDate)
      lines.push(`Target date: ${args.linearProject.targetDate}`);
    lines.push("");
  }

  if (args.linearUpdates.length > 0) {
    lines.push(
      `## Linear project updates (pre-fetched, newest first — ${args.linearUpdates.length})`,
    );
    for (const u of args.linearUpdates.slice(0, 6)) {
      const when = u.createdAt.slice(0, 10);
      const who = u.user.displayName;
      lines.push(`- **${when}** (${who}, health=${u.health}):`);
      lines.push(indent(u.body.trim(), "  "));
    }
    lines.push("");
  }

  if (args.linearIssues.length > 0) {
    lines.push(
      `## Linear issues — top-level (${args.linearIssues.length} total, pre-fetched)`,
    );
    for (const i of args.linearIssues) {
      const assignee = i.assignee
        ? ` — ${i.assignee.displayName ?? i.assignee.name}`
        : "";
      lines.push(`- \`${i.identifier}\` (${i.state.name}) ${i.title}${assignee}`);
    }
    lines.push("");
  }

  if (args.p2Posts.length > 0) {
    lines.push(
      `## P2 launch post + comments (pre-fetched from ${args.project.p2_url ?? "p2_url"})`,
    );
    for (const post of args.p2Posts) {
      lines.push(`### ${post.title || "(untitled post)"}`);
      lines.push(
        `Posted: ${post.date.slice(0, 10)} · ${post.author.display_name} (@${post.author.username}) · ${post.link}`,
      );
      if (post.content_text.trim()) {
        lines.push("");
        lines.push("Body:");
        lines.push("```text");
        lines.push(post.content_text.trim());
        lines.push("```");
      }
      if (post.comments.length > 0) {
        lines.push("");
        lines.push(
          `Comments (${post.comments_total}${post.comments_truncated ? "+, truncated" : ""}):`,
        );
        for (const c of post.comments) {
          const when = c.date.slice(0, 10);
          lines.push(
            `- **${when}** ${c.author.display_name} (@${c.author.username}):`,
          );
          lines.push(indent(c.content_text.trim(), "  "));
        }
      }
      lines.push("");
    }
  }

  if (args.linearIssueDetails.length > 0) {
    lines.push(
      `## Linear issue detail with comments (top ${args.linearIssueDetails.length} by recency, pre-fetched)`,
    );
    for (const d of args.linearIssueDetails) {
      lines.push(`### \`${d.identifier}\` — ${d.title}`);
      lines.push(
        `State: ${d.state.name} · Updated: ${d.updatedAt.slice(0, 10)} · ${d.url}`,
      );
      if (d.description?.trim()) {
        lines.push("");
        lines.push(d.description.trim());
      }
      if (d.comments.length > 0) {
        lines.push("");
        lines.push(`Comments (${d.comments.length}):`);
        for (const c of d.comments) {
          const when = c.createdAt.slice(0, 10);
          lines.push(`- **${when}** ${c.user.displayName}:`);
          lines.push(indent(c.body.trim(), "  "));
        }
      }
      lines.push("");
    }
  }

  lines.push("## Partner knowledge (from Hive Mind)");
  if (args.hmPartner) {
    if (args.hmPartner.title) lines.push(`Title: ${args.hmPartner.title}`);
    if (args.hmPartner.description)
      lines.push(`Description: ${args.hmPartner.description}`);
    if (args.hmPartner.body.trim()) {
      lines.push("Body:");
      lines.push("```markdown");
      lines.push(args.hmPartner.body);
      lines.push("```");
    }
  } else {
    lines.push("(no partner-knowledge.md found)");
  }
  lines.push("");

  lines.push("## Project info (from Hive Mind)");
  if (args.hmProject) {
    if (args.hmProject.title) lines.push(`Title: ${args.hmProject.title}`);
    if (args.hmProject.description)
      lines.push(`Description: ${args.hmProject.description}`);
    if (args.hmProject.body.trim()) {
      lines.push("Body:");
      lines.push("```markdown");
      lines.push(args.hmProject.body);
      lines.push("```");
    }
  } else {
    lines.push(`Project name (from vault): ${args.project.name}`);
  }
  lines.push("");

  lines.push("## P2 context (pasted — supplements pre-fetched post above)");
  lines.push(args.userContext.p2.trim() || "(none provided)");
  lines.push("");

  lines.push(
    "## Linear context (pasted — supplements pre-fetched issues/updates above)",
  );
  lines.push(args.userContext.linear.trim() || "(none provided)");
  lines.push("");

  lines.push("## Slack context (pasted)");
  lines.push(args.userContext.slack.trim() || "(none provided)");
  lines.push("");

  lines.push("## Features to highlight (with code snippets if relevant)");
  lines.push(args.userContext.features.trim() || "(none provided)");
  lines.push("");

  lines.push("## Lessons learned + A8C product feedback");
  lines.push(args.userContext.lessons.trim() || "(none provided)");
  lines.push("");

  lines.push("## Note to the agent");
  lines.push(
    "Smithers pre-gathered the project identifiers, Linear metadata, and HM knowledge above. The TAM pasted P2/Linear/Slack/features/lessons context. MCP is NOT available in this run — do not call any context-a8c tools. For each Development feature subsection, add a repo-relative Markdown image reference (`![alt](assets/launched-" +
      args.launchDate +
      "/<descriptive-slug>.png)`) and list the expected filename under `questions` so the wizard can collect the file. Do the same for Design BEFORE/AFTER images. Code snippets are NOT images — leave them as inline `[CODE SNIPPET: …]` text slots.",
  );

  return lines.join("\n");
}

function renderAssetsManifest(args: {
  launchDate: string;
  filenames: string[];
}): string {
  const lines: string[] = [];
  lines.push(`# Launch post assets — ${args.launchDate}`);
  lines.push("");
  lines.push(
    "Image files referenced by `../launched-" +
      args.launchDate +
      ".md`. Uploaded via Smithers' launch-post wizard.",
  );
  lines.push("");
  for (const f of args.filenames) {
    lines.push(`- \`${f}\``);
  }
  lines.push("");
  return lines.join("\n");
}

function indent(text: string, prefix: string): string {
  if (!text) return text;
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

/**
 * Parse a P2 post URL into the (site, slug) pair the wpcom posts-text
 * tool needs. A P2 post URL is shaped like
 * `https://<host>/<YYYY>/<MM>/<DD>/<slug>/` (sometimes with no trailing
 * slash, sometimes shorter). The slug is the last non-empty path
 * segment that doesn't look like a date component. Returns null when
 * the URL is malformed or doesn't carry a slug.
 */
function parseP2Url(
  raw: string,
): { site: string; slug: string } | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    const slug = segments[segments.length - 1] ?? "";
    if (!slug || /^\d+$/.test(slug)) return null;
    return { site: url.host, slug };
  } catch {
    return null;
  }
}
