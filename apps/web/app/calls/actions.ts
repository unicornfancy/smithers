"use server";

import { revalidatePath } from "next/cache";

import {
  analyzeCallTranscript,
  type AnalyzeCallTranscriptOutput,
} from "@smithers/agents";

import { getAgentRuntime } from "@/lib/server/agents";
import { getMcpClient } from "@/lib/server/mcp";
import { getVault } from "@/lib/server/vault";

/**
 * Append a search term to a project's `fathom_search_terms`. Used by the
 * /calls "Match to project" picker — the term is typically a partner
 * contact name or a fragment of the recording title that will route
 * future calls automatically.
 */
export async function addFathomSearchTermAction(
  slug: string,
  term: string,
): Promise<{ ok: true; terms: string[] } | { ok: false; reason: string }> {
  const trimmed = term.trim();
  if (!slug || !trimmed) {
    return { ok: false, reason: "slug and term are required" };
  }
  const vault = await getVault();
  try {
    const project = await vault.readProject(slug);
    if (!project) return { ok: false, reason: "Project not found" };
    const next = Array.from(
      new Set([...(project.fathom_search_terms ?? []), trimmed]),
    );
    const result = await vault.setProjectFathomSearchTerms(slug, next);
    revalidatePath("/calls");
    revalidatePath(`/projects/${slug}`);
    return { ok: true, terms: result.fathom_search_terms };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed",
    };
  }
}

/**
 * Run the analyze-call agent on a recording without a project association
 * — for internal team calls where the user is just taking notes. Saves
 * the analysis to vault Call Notes/ with no project_slug. Cache hit
 * returns the existing analysis without re-running the agent.
 */
export async function analyzeTeamCallAction(input: {
  recordingId: string;
  url?: string;
  recordingTitle?: string;
  recordedAt?: string;
  force?: boolean;
}): Promise<
  | {
      ok: true;
      data: AnalyzeCallTranscriptOutput;
      cached: boolean;
      analyzed_at: string;
      relative_path: string;
      absolute_path: string;
    }
  | {
      ok: false;
      reason: "not-configured" | "transcript-missing" | "error";
      message?: string;
    }
> {
  const recordingId = input.recordingId.trim();
  if (!recordingId) return { ok: false, reason: "error", message: "recordingId is required" };

  const vault = await getVault();

  if (!input.force) {
    const existing = await vault
      .findCallNotesByRecordingId(recordingId)
      .catch(() => null);
    if (existing) {
      return {
        ok: true,
        data: coerceSavedAnalysis(existing.analysis),
        cached: true,
        analyzed_at: existing.analyzed_at,
        relative_path: existing.relative_path,
        absolute_path: existing.absolute_path,
      };
    }
  }

  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const mcp = await getMcpClient();
  const transcript = await mcp.fathom
    .fetchTranscript({ recording_id: recordingId, url: input.url })
    .catch(() => null);
  if (!transcript) {
    return {
      ok: false,
      reason: "transcript-missing",
      message:
        "Couldn't fetch the transcript from Fathom. The recording may not be processed yet, or you may need to re-auth Fathom MCP.",
    };
  }

  const styleSource = await vault.readStyleGuide().catch(() => null);
  const style = styleSource
    ? { label: "User's writing style", body: styleSource.body }
    : undefined;

  try {
    const result = await analyzeCallTranscript(runtime, {
      transcript,
      // No project — team/internal call.
      call: {
        recording_id: recordingId,
        title: input.recordingTitle ?? null,
        recorded_at: input.recordedAt ?? null,
        url: input.url ?? null,
      },
      style,
    });
    const saved = await vault.saveCallNotes({
      recording: {
        recording_id: recordingId,
        title: input.recordingTitle ?? null,
        recorded_at: input.recordedAt ?? null,
        url: input.url ?? null,
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
    });
    revalidatePath("/calls");
    return {
      ok: true,
      data: result.output,
      cached: false,
      analyzed_at: saved.analyzed_at,
      relative_path: saved.relative_path,
      absolute_path: saved.absolute_path,
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
 * Coerce the stored analysis (which uses concrete required fields like
 * `owner: string`) back into the agent output shape (where some fields
 * are optional). Lossless because we always store with defaults filled in.
 */
function coerceSavedAnalysis(
  saved: {
    summary: string;
    action_items: Array<{ text: string; owner: string }>;
    follow_ups: Array<{ task: string; rationale: string; follow_up_by?: string }>;
    decisions: Array<{ text: string; context?: string }>;
    key_quotes: Array<{ speaker: string; text: string }>;
  },
): AnalyzeCallTranscriptOutput {
  const validOwners = new Set(["user", "partner", "team", "unknown"]);
  return {
    summary: saved.summary,
    action_items: saved.action_items.map((a) => ({
      text: a.text,
      owner: validOwners.has(a.owner)
        ? (a.owner as "user" | "partner" | "team" | "unknown")
        : "unknown",
    })),
    follow_ups: saved.follow_ups,
    decisions: saved.decisions,
    key_quotes: saved.key_quotes,
  };
}
