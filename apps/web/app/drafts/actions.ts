"use server";

import { revalidatePath } from "next/cache";

import {
  learnStyleFromArchives,
  type LearnStyleFromArchivesOutput,
} from "@smithers/agents";
import type { ContextItem } from "@smithers/mcp-client";
import { slugify } from "@smithers/vault";

import { getAgentRuntime } from "@/lib/server/agents";
import { getMcpClient } from "@/lib/server/mcp";
import { loadStyleReference } from "@/lib/server/style";
import { getVault } from "@/lib/server/vault";

/**
 * Replace a draft's body. Frontmatter is preserved verbatim — only the
 * markdown content after the YAML block is rewritten. Atomic.
 */
export async function updateDraftBodyAction(
  draftId: string,
  body: string,
): Promise<{ changed: boolean }> {
  if (!draftId) throw new Error("draftId is required");
  const vault = await getVault();
  const result = await vault.updateDraftBody(draftId, body);
  revalidatePath(`/drafts/${draftId}`);
  revalidatePath("/drafts");
  return { changed: result.changed };
}

/**
 * Move a draft from `Drafts/` to `Drafts/Archived Drafts/`. Frontmatter
 * gets stamped with `state: archived` and `archived_at`; `original_body`
 * (when present) is preserved through the move so the style-learning
 * loop can compute diffs after the fact.
 */
export async function archiveDraftAction(
  draftId: string,
): Promise<{ relative_path: string }> {
  if (!draftId) throw new Error("draftId is required");
  const vault = await getVault();
  const result = await vault.archiveDraft(draftId);
  revalidatePath("/drafts");
  revalidatePath(`/drafts/${draftId}`);
  return { relative_path: result.relative_path };
}

/**
 * Run the learn-style-from-archives agent over recent archived drafts
 * with original/final pairs. Returns the agent's pattern list +
 * suggested style-guide addition (markdown, ready to paste).
 *
 * Returns null when there aren't enough samples yet (need at least 3
 * archived drafts with `original_body` snapshotted in frontmatter).
 */
export async function learnStyleFromArchivesAction(): Promise<
  | {
      ok: true;
      data: LearnStyleFromArchivesOutput;
      sample_count: number;
    }
  | {
      ok: false;
      reason: "not-configured" | "insufficient-samples" | "error";
      sample_count?: number;
      message?: string;
    }
> {
  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const vault = await getVault();
  const samples = await vault
    .listArchivedDraftsWithDiffs(25)
    .catch(() => []);
  if (samples.length < 3) {
    return {
      ok: false,
      reason: "insufficient-samples",
      sample_count: samples.length,
      message:
        "Need at least 3 archived drafts with an `original_body` snapshot to learn from.",
    };
  }

  const style = await loadStyleReference();
  try {
    const result = await learnStyleFromArchives(runtime, {
      samples: samples.map((s) => ({
        draft_id: s.draft_id,
        title: s.title,
        channel: s.channel,
        source_agent: s.source_agent,
        original: s.original_body,
        final: s.final_body,
      })),
      existing_style_guide: style?.body,
    });
    return { ok: true, data: result.output, sample_count: samples.length };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Agent call failed",
    };
  }
}

/**
 * Save AI-generated content as a new draft file in `Drafts/`. The
 * agent's first pass is snapshotted into frontmatter (`original_body`)
 * so archive-time diffs can teach the style guide later.
 *
 * When the draft belongs to a Hive-Mind-connected project (parent
 * project has `hive_mind_partner_slug`), also dual-writes a copy to
 * the project's `drafts/` folder in Hive-Mind so the team can see and
 * review it. Vault remains the editable source for the live draft;
 * Hive-Mind gets the snapshot at save time.
 */
export async function saveAsDraftAction(input: {
  project_slug?: string;
  title: string;
  body: string;
  original_body?: string;
  source_agent?: string;
  subject?: string;
  channel?: string;
  context_preview?: string;
  context_preview_label?: string;
  context_preview_meta?: string;
}): Promise<{ draft_id: string; relative_path: string }> {
  if (!input.title.trim()) throw new Error("title is required");
  if (!input.body.trim()) throw new Error("body is required");
  const vault = await getVault();
  const result = await vault.createDraftFromAi(input);
  revalidatePath("/drafts");
  if (input.project_slug) {
    revalidatePath(`/projects/${input.project_slug}`);
  }

  if (input.project_slug) {
    const project = await vault.readProject(input.project_slug).catch(() => null);
    if (project?.hive_mind_partner_slug) {
      const hmPartner = project.hive_mind_partner_slug;
      const hmProject = project.hive_mind_project_slug ?? project.slug;
      const today = new Date().toISOString().slice(0, 10);
      const filename = `drafts/${today}-${slugify(input.title)}.md`;
      const content = buildHmDraftFile({
        title: input.title,
        partnerSlug: hmPartner,
        projectSlug: hmProject,
        date: today,
        type: input.channel || "partner-email",
        sourceAgent: input.source_agent,
        subject: input.subject,
        body: input.body,
      });
      try {
        const mcp = await getMcpClient();
        await mcp.hiveMind.writeProjectFile(hmPartner, hmProject, filename, content);
        await mcp.hiveMind.commit(
          `drafts: add ${input.title} for ${hmPartner}/${hmProject}`,
        );
      } catch {
        // HM sync failure is non-fatal; vault copy is the editable source.
      }
    }
  }

  return {
    draft_id: result.draft_id,
    relative_path: result.relative_path,
  };
}

function buildHmDraftFile(args: {
  title: string;
  partnerSlug: string;
  projectSlug: string;
  date: string;
  type: string;
  sourceAgent?: string;
  subject?: string;
  body: string;
}): string {
  const fmLines = [
    "---",
    `title: ${JSON.stringify(args.title)}`,
    `partner: ${args.partnerSlug}`,
    `project: ${args.projectSlug}`,
    `date: ${args.date}`,
    `type: ${args.type}`,
    "status: draft",
    `updated: ${args.date}`,
  ];
  if (args.sourceAgent) fmLines.push(`source_agent: ${args.sourceAgent}`);
  fmLines.push("---");
  const subjectSection = `## Subject\n\n${args.subject ?? ""}\n`;
  const bodySection = `## Body\n\n${args.body.trim()}\n`;
  return [fmLines.join("\n"), "", subjectSection, bodySection].join("\n");
}

/**
 * Resolve a Slack / GitHub / Zendesk URL into a `ContextItem` the user
 * can attach to a draft. Used by the draft context picker (Phase H3).
 *
 * - Slack URLs (message or thread) → context-a8c slack/get
 * - GitHub issue / PR URLs → context-a8c github/issue or github/pull-request
 *   (head + comments, flattened to a text block)
 * - Zendesk ticket URLs → looked up via the existing search summaries to
 *   get subject + status; body content is unavailable upstream so the
 *   resolved item carries metadata only.
 *
 * Returns a discriminated result so the UI can show a clean error
 * instead of crashing on parse / fetch failures.
 */
export async function resolveContextUrlAction(
  url: string,
): Promise<{ ok: true; item: ContextItem } | { ok: false; reason: string }> {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, reason: "URL is required" };

  const mcp = await getMcpClient();

  if (/^https?:\/\/[^/]*\.slack\.com\//i.test(trimmed)) {
    const resolved = await mcp.contextA8C.resolveSlackUrl(trimmed);
    if (!resolved) {
      return {
        ok: false,
        reason: "Couldn't fetch the Slack URL — check that ContextA8C is authenticated and the URL is reachable.",
      };
    }
    return {
      ok: true,
      item: { type: resolved.type, ref: trimmed, label: resolved.label, body: resolved.body },
    };
  }

  if (/^https?:\/\/(?:www\.)?github\.com\//i.test(trimmed)) {
    const resolved = await mcp.contextA8C.resolveGithubUrl(trimmed);
    if (!resolved) {
      return {
        ok: false,
        reason: "Couldn't fetch the GitHub URL. Only issue / PR URLs are supported (e.g. .../issues/42 or .../pull/7).",
      };
    }
    return {
      ok: true,
      item: { type: resolved.type, ref: trimmed, label: resolved.label, body: resolved.body },
    };
  }

  if (/^https?:\/\/linear\.app\//i.test(trimmed)) {
    const resolved = await mcp.linear.resolveLinearUrl(trimmed);
    if (!resolved) {
      return {
        ok: false,
        reason: "Couldn't fetch the Linear URL. Supported: issue URLs (.../issue/<TEAM>-<NUM>) and project URLs (.../project/<slug>).",
      };
    }
    return {
      ok: true,
      item: { type: resolved.type, ref: trimmed, label: resolved.label, body: resolved.body },
    };
  }

  if (/zendesk\.com\/agent\/tickets\/(\d+)/i.test(trimmed)) {
    const m = /\/tickets\/(\d+)/.exec(trimmed);
    const ticketId = m?.[1];
    if (!ticketId) return { ok: false, reason: "Couldn't parse Zendesk ticket id." };
    const summaries = await mcp.contextA8C
      .fetchZendeskTicketSummaries([ticketId])
      .catch(() => null);
    const summary = summaries?.find((s) => s.id === ticketId) ?? null;
    if (!summary) {
      return { ok: false, reason: "Zendesk ticket not found via search." };
    }
    const subject = summary.subject ?? `Ticket #${ticketId}`;
    const status = summary.status ?? "unknown";
    return {
      ok: true,
      item: {
        type: "zendesk-ticket",
        ref: trimmed,
        label: `Zendesk #${ticketId} — ${subject}`,
        // Body is metadata-only since upstream doesn't expose comments.
        body: `Zendesk ticket #${ticketId}\nSubject: ${subject}\nStatus: ${status}`,
      },
    };
  }

  return {
    ok: false,
    reason: "Unsupported URL. Paste a Slack message/thread URL, GitHub issue/PR URL, or Zendesk ticket URL.",
  };
}

/**
 * Resolve a call transcript suggestion into a `ContextItem`. Call
 * transcripts live in the Hive-Mind project folder (not at a URL), so
 * `resolveContextUrlAction` doesn't apply — the picker calls this when
 * the user toggles a `type: "call-transcript"` suggestion ON. Body is
 * the full transcript markdown so the agent has the same content the
 * user would paste manually.
 */
export async function resolveCallTranscriptContextAction(input: {
  partnerSlug: string;
  projectSlug: string;
  /** Relative path within the HM project, e.g. `call-transcripts/2026-05-04-foo.md`. */
  ref: string;
}): Promise<
  | { ok: true; item: ContextItem }
  | { ok: false; reason: string }
> {
  const { partnerSlug, projectSlug, ref } = input;
  if (!partnerSlug || !projectSlug) {
    return { ok: false, reason: "partnerSlug and projectSlug are required" };
  }
  if (!ref.trim()) return { ok: false, reason: "ref is required" };

  const vault = await getVault();
  const transcripts = await vault
    .getHiveMindCallTranscripts(partnerSlug, projectSlug)
    .catch(() => []);
  const expectedFilename = ref.replace(/^call-transcripts\//, "");
  const match = transcripts.find((t) => t.filename === expectedFilename);
  if (!match) {
    return { ok: false, reason: "Call transcript not found in Hive-Mind." };
  }

  const label = match.frontmatter.title ?? expectedFilename.replace(/\.md$/i, "");
  return {
    ok: true,
    item: {
      type: "call-transcript",
      ref,
      label,
      body: match.body,
    },
  };
}
