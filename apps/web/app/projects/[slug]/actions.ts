"use server";

import { revalidatePath } from "next/cache";

import {
  analyzeCallTranscript,
  chatAboutTranscript,
  composeCallRecap,
  composeFollowUpNudge,
  draftP2Update,
  draftZendeskReply,
  suggestNextStep,
  type AnalyzeCallTranscriptOutput,
  type CallActionItem,
  type CallDecision,
  type CallFollowUp,
  type ComposeCallRecapOutput,
  type ComposeNudgeOutput,
  type DraftP2UpdateOutput,
  type DraftZendeskReplyOutput,
  type SuggestNextStepOutput,
} from "@smithers/agents";
import type {
  CallRecordingRef,
  ContextItem,
  LinearProjectMetadata,
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
import { getMcpClient } from "@/lib/server/mcp";
import { loadStyleReference } from "@/lib/server/style";
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

  // Dual-write: sync zendesk.md in Hive Mind when connected.
  const project = await vault.readProject(slug).catch(() => null);
  if (project?.hive_mind_partner_slug) {
    const hmPartner = project.hive_mind_partner_slug;
    const hmProject = project.hive_mind_project_slug ?? project.slug;
    try {
      const allTickets = result.zendesk_tickets;
      const content = serializeHMZendesk({
        search_terms: project.zendesk_search_terms ?? [],
        last_refreshed: new Date().toISOString().slice(0, 10),
        tickets: allTickets.map((t) => ({
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
      // HM sync failure is non-fatal.
    }
  }

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
  // [] when the upstream tool isn't available, which is fine.
  const mcp = await getMcpClient();
  const recent = await mcp.contextA8C
    .fetchZendeskTicketActivity(ticketId, {
      projectSlug: slug,
      limit: 10,
    })
    .catch(() => []);
  const lastPartner = recent.find((e) => e.actor?.is_external === true);
  const lastInternal = recent.find((e) => e.actor?.is_external === false);

  const style = (await loadStyleReference()) ?? undefined;

  try {
    const result = await draftZendeskReply(runtime, {
      project,
      thread: {
        id: thread.id,
        subject: thread.subject ?? null,
        status: thread.status ?? null,
        last_partner_excerpt: lastPartner?.excerpt ?? null,
        last_internal_excerpt: lastInternal?.excerpt ?? null,
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
  const transcript = await mcp.fathom
    .fetchTranscript({ recording_id: recordingId, url })
    .catch(() => null);
  if (!transcript) {
    return {
      ok: false,
      reason: "transcript-missing",
      message:
        "Couldn't fetch the transcript from Fathom. The recording may not be processed yet, or you may need to re-auth Fathom MCP.",
    };
  }

  const style = (await loadStyleReference()) ?? undefined;

  try {
    const result = await analyzeCallTranscript(runtime, {
      transcript,
      project,
      call: { recording_id: recordingId, url },
      style,
      additionalInstructions: opts?.additionalInstructions,
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
  const transcript = await mcp.fathom
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
  const transcript = await mcp.fathom
    .fetchTranscript({ recording_id: recordingId, url })
    .catch(() => null);
  if (!transcript) {
    return {
      ok: false,
      reason: "transcript-missing",
      message: "Couldn't fetch the transcript from Fathom.",
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
  const transcript = await mcp.fathom
    .fetchTranscript({ recording_id: recordingId, url })
    .catch(() => null);
  if (!transcript) {
    return {
      ok: false,
      reason: "transcript-missing",
      message: "Couldn't fetch the transcript from Fathom.",
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
 * `## Decisions` section as a per-call sub-block. Creates the section
 * if it doesn't exist yet.
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
  const result = await vault.appendDecisionsToProject(slug, {
    call_title: callTitle,
    call_date: callDate,
    call_url: callUrl,
    decisions,
  });
  revalidatePath(`/projects/${slug}`);
  return { added: result.changed ? decisions.length : 0 };
}

/**
 * Append a batch of call-derived follow-ups to Follow-ups.md. Project
 * column is taken from the workbench's project name so the matcher
 * picks them up. Source column links back to the recording when a
 * URL was passed.
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

  // Dual-write: sync follow-ups.md in Hive Mind when connected.
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
  if (!slug) throw new Error("slug is required");
  if (!followUpId) throw new Error("followUpId is required");
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("days must be a positive number");
  }

  const target = new Date();
  target.setUTCDate(target.getUTCDate() + Math.round(days));
  const newFollowUpBy = target.toISOString().slice(0, 10);

  const vault = await getVault();
  const result = await vault.snoozeFollowUp(followUpId, newFollowUpBy);

  revalidatePath(`/projects/${slug}`);
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
        p2_url: project.p2_url,
        primary_slack_channel: project.primary_slack_channel,
        team_slack_channel: project.team_slack_channel,
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
