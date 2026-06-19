"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  analyzeCallTranscript,
  type AnalyzeCallTranscriptOutput,
} from "@smithers/agents";

import { getAgentRuntime } from "@/lib/server/agents";
import { loadConfig } from "@/lib/server/config";
import { getMcpClient } from "@/lib/server/mcp";
import { loadStyleReference } from "@/lib/server/style";
import { getTranscriptionAdapter } from "@/lib/server/transcription";
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

  const transcription = await getTranscriptionAdapter();
  const transcript = await transcription
    .fetchTranscript({ recording_id: recordingId, url: input.url })
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
      // No project — team/internal call.
      call: {
        recording_id: recordingId,
        title: input.recordingTitle ?? null,
        recorded_at: input.recordedAt ?? null,
        url: input.url ?? null,
      },
      style,
      systemPromptOverride,
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
 * Process a transcript pasted from outside Smithers — a Granola
 * export, a Fathom share from another TAM, a Whisper dump, etc. Runs
 * through the same analyze-call-transcript agent + saveCallNotes
 * pipeline as the in-app "Process call" flow, with a synthetic
 * recording_id derived from a hash of the transcript so re-imports
 * collapse onto the same file instead of creating duplicates.
 */
export async function processExternalCallAction(input: {
  transcript: string;
  /** Display title for the call (used in the saved file name). */
  title: string;
  /** ISO date when the call occurred (YYYY-MM-DD or full ISO). Defaults to today. */
  recorded_at?: string;
  /** Project slug to associate the call with. Empty for team/orphan calls. */
  project_slug?: string;
  /** Free-form note about who provided the transcript ("Bob during cover"). Goes into the saved file's frontmatter. */
  source?: string;
  /** Optional URL pointing back at the original transcript (Granola share, Otter doc, etc). */
  source_url?: string;
}): Promise<
  | {
      ok: true;
      cached: boolean;
      data: AnalyzeCallTranscriptOutput;
      analyzed_at: string;
      relative_path: string;
      absolute_path: string;
    }
  | {
      ok: false;
      reason: "not-configured" | "empty-transcript" | "error";
      message?: string;
    }
> {
  const transcript = input.transcript.trim();
  if (!transcript) {
    return { ok: false, reason: "empty-transcript" };
  }
  const title = input.title.trim() || "External call";
  const recordedAt = (input.recorded_at?.trim() || new Date().toISOString().slice(0, 10));
  // Hash of the transcript body gives us a stable, idempotent id —
  // re-pasting the same transcript collapses onto the same Call Notes
  // file instead of accumulating duplicates.
  const hash = createHash("sha256").update(transcript).digest("hex").slice(0, 10);
  const recordingId = `external-${hash}`;

  const vault = await getVault();

  // Cache hit short-circuit — same transcript already processed.
  const existing = await vault.findCallNotesByRecordingId(recordingId).catch(() => null);
  if (existing) {
    return {
      ok: true,
      cached: true,
      data: coerceSavedAnalysis(existing.analysis),
      analyzed_at: existing.analyzed_at,
      relative_path: existing.relative_path,
      absolute_path: existing.absolute_path,
    };
  }

  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const style = (await loadStyleReference()) ?? undefined;
  const cfg = await loadConfig();
  const systemPromptOverride =
    cfg.agents.analyze_call_transcript_prompt?.trim() || undefined;

  try {
    const result = await analyzeCallTranscript(runtime, {
      transcript,
      call: {
        recording_id: recordingId,
        title,
        recorded_at: recordedAt,
        url: input.source_url ?? null,
      },
      style,
      systemPromptOverride,
    });

    const saved = await vault.saveCallNotes({
      project_slug: input.project_slug?.trim() || undefined,
      recording: {
        recording_id: recordingId,
        title,
        recorded_at: recordedAt,
        url: input.source_url ?? null,
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
    if (input.project_slug?.trim()) {
      revalidatePath(`/projects/${input.project_slug.trim()}`);
    }

    return {
      ok: true,
      cached: false,
      data: result.output,
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
