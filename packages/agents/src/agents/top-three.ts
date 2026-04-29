import { runAgent } from "../runner";
import type {
  AgentResult,
  AgentRuntimeOptions,
  StyleReference,
} from "../types";

/**
 * One candidate as the agent sees it. We deliberately keep the shape
 * minimal — the LLM doesn't need the score breakdown to do its job; it
 * needs enough context to write the "why this matters" line.
 */
export interface TopThreeCandidateInput {
  candidate_id: string;
  source: "ping" | "follow_up" | "project_task" | "draft";
  task: string;
  context?: string;
  project_name?: string;
  project_status?: string;
  /** Pre-computed rules-based score, included so the model can sanity-check ordering. */
  score: number;
  /** Human-readable score breakdown the model uses for "why this matters" copy. */
  score_breakdown: { reason: string; delta: number }[];
}

export interface ComposeTopThreeInput {
  candidates: TopThreeCandidateInput[];
  /**
   * "morning" before 11am: forward-looking, prep-aware
   * "midday" 11-14: standard
   * "afternoon" 14+: closure-oriented, deprioritize long drafts
   */
  timeOfDay: "morning" | "midday" | "afternoon";
  /** Day of week so the model can adjust (Monday adds weekly update; Friday adds reflection). */
  dayOfWeek:
    | "Mon"
    | "Tue"
    | "Wed"
    | "Thu"
    | "Fri"
    | "Sat"
    | "Sun";
  /** Total candidates considered — the model mentions concentration in reasoning when relevant. */
  candidateCount: number;
  /**
   * Candidate ids the user has pinned for today. The agent MUST include
   * each one in its picks. If pinned.length >= 3, the agent picks among
   * them; if pinned.length < 3, it fills the rest from the highest-
   * scoring unpinned candidates.
   */
  pinnedIds?: string[];
  /** Optional voice reference. */
  style?: StyleReference;
}

export interface TopThreePick {
  candidate_id: string;
  /** Restated task title. May trim or rephrase from the original. */
  title: string;
  /** Why this matters today, in user's voice. 1-2 sentences. */
  why: string;
  /** Concrete next action — the verb the user takes today. */
  next_action: string;
}

export interface TopThreeOutput {
  picks: [TopThreePick, TopThreePick, TopThreePick];
  /** Optional concentration-aware framing for the day, surfaced under the trio. */
  framing: string;
}

const SYSTEM_PROMPT = `You are Smithers, a personal assistant choosing today's Top 3 for the user.

Your job: pick exactly 3 of the candidates and write a "why this matters" line per pick that captures the urgency, tradeoff, or decision at stake. Then write a one-line framing for the day.

Rules:
- Pick 3 — never 2, never 4.
- If the user has pinned candidates, EVERY pinned candidate MUST appear in your picks. They override score. If pinned.length >= 3, pick from among the pinned. If pinned.length < 3, include all pinned + fill the rest from the highest-scoring unpinned candidates.
- Score is a strong prior for unpinned candidates. Don't pick a score-1 candidate over a score-7 candidate without naming the reason.
- No artificial diversity. If one project genuinely owns the day (multiple force-decide stalls, or a hot thread + calendar prep), let it. Acknowledge the concentration in your framing.
- Write in the user's voice if a style guide is provided. Default voice: terse, action-oriented, no corporate filler.
- "why" sentences should reference what's at stake, not just restate the task. Examples:
  - Good: "Fourth attempt at this thread — without a reply by EOD, the launch slips."
  - Bad: "This is a follow-up that has been waiting a long time."
- "next_action" must be a concrete verb the user can do today (Reply, Draft, Decide, Ship, etc.) plus the object.

Time-of-day adjustment:
- morning: forward-looking. Favor prep, drafting, and starting threads that take time to land.
- midday: standard.
- afternoon: closure-oriented. Favor decisions, replies, and quick wins. Deprioritize long-form drafting tasks unless they're due today.

Day-of-week adjustment:
- Mon: include the weekly update if it's a candidate.
- Fri: include end-of-week reflection or post-launch closure if relevant.
- Other days: no special handling.

Output JSON only, matching the schema. No prose outside the JSON.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      // Anthropic structured-output constraint: array `minItems`/`maxItems`
      // can only be 0 or 1. We enforce "exactly 3" via the system prompt
      // and the validator below.
      items: {
        type: "object",
        properties: {
          candidate_id: {
            type: "string",
            description: "Must be one of the candidate_id values you were given.",
          },
          title: { type: "string" },
          why: {
            type: "string",
            description:
              "1-2 sentences capturing what's at stake or why this matters today.",
          },
          next_action: {
            type: "string",
            description:
              "Concrete verb + object (Reply, Draft, Decide, Ship, Confirm, etc.).",
          },
        },
        required: ["candidate_id", "title", "why", "next_action"],
        additionalProperties: false,
      },
    },
    framing: {
      type: "string",
      description: "One sentence framing for the day. Mentions concentration when applicable.",
    },
  },
  required: ["picks", "framing"],
  additionalProperties: false,
};

export async function composeTopThree(
  runtime: AgentRuntimeOptions,
  input: ComposeTopThreeInput,
): Promise<AgentResult<TopThreeOutput>> {
  return runAgent(runtime, {
    agent: "top-3",
    system: SYSTEM_PROMPT,
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "TopThreeOutput",
    effort: "high",
    thinking: true,
    maxTokens: 4096,
    validate: (raw) =>
      validateOutput(raw, input.candidates, input.pinnedIds ?? []),
  });
}

function renderUserPrompt(input: ComposeTopThreeInput): string {
  const lines: string[] = [];
  lines.push(`# Today: ${input.dayOfWeek} · ${input.timeOfDay}`);
  lines.push(`Total candidates considered: ${input.candidateCount}`);

  const pinnedIds = input.pinnedIds ?? [];
  if (pinnedIds.length > 0) {
    lines.push("");
    lines.push("# Pinned by user (must appear in your picks)");
    for (const id of pinnedIds) {
      lines.push(`- ${id}`);
    }
  }

  lines.push("");
  lines.push("# Candidates (sorted highest score first)");

  for (const c of input.candidates) {
    lines.push("");
    const pinMarker = pinnedIds.includes(c.candidate_id) ? " 📌 PINNED" : "";
    lines.push(`## [${c.candidate_id}]${pinMarker} score ${c.score.toFixed(1)}`);
    lines.push(`- Source: ${c.source}`);
    if (c.project_name) lines.push(`- Project: ${c.project_name}`);
    if (c.project_status) lines.push(`- Status: ${c.project_status}`);
    lines.push(`- Task: ${c.task}`);
    if (c.context) lines.push(`- Context: ${c.context}`);
    if (c.score_breakdown.length > 0) {
      lines.push(`- Why scored: ${formatBreakdown(c.score_breakdown)}`);
    }
  }

  if (input.style) {
    lines.push("");
    lines.push(`# ${input.style.label}`);
    lines.push(input.style.body.trim());
  }

  lines.push("");
  lines.push(
    "Pick 3. Each pick's `candidate_id` must be one of the IDs above verbatim. Return JSON only.",
  );

  return lines.join("\n");
}

function formatBreakdown(
  breakdown: { reason: string; delta: number }[],
): string {
  return breakdown
    .map((r) => `${r.reason} (${r.delta >= 0 ? "+" : ""}${r.delta})`)
    .join(", ");
}

function validateOutput(
  raw: unknown,
  candidates: TopThreeCandidateInput[],
  pinnedIds: readonly string[],
): TopThreeOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const picks = obj.picks;
  if (!Array.isArray(picks) || picks.length !== 3) {
    throw new Error("picks must be an array of exactly 3");
  }
  const validIds = new Set(candidates.map((c) => c.candidate_id));
  const validatedPicks = picks.map((p, i) => validatePick(p, i, validIds));
  const pickedIds = new Set(validatedPicks.map((p) => p.candidate_id));
  for (const pinnedId of pinnedIds) {
    if (!pickedIds.has(pinnedId)) {
      throw new Error(
        `pinned candidate "${pinnedId}" is missing from picks — agent ignored a pin`,
      );
    }
  }
  const framing = typeof obj.framing === "string" ? obj.framing : "";
  return {
    picks: [validatedPicks[0]!, validatedPicks[1]!, validatedPicks[2]!],
    framing,
  };
}

function validatePick(
  raw: unknown,
  index: number,
  validIds: Set<string>,
): TopThreePick {
  if (!raw || typeof raw !== "object") {
    throw new Error(`picks[${index}] is not an object`);
  }
  const obj = raw as Record<string, unknown>;
  const candidate_id = requireString(obj, "candidate_id", index);
  if (!validIds.has(candidate_id)) {
    throw new Error(
      `picks[${index}].candidate_id "${candidate_id}" not in candidate set`,
    );
  }
  return {
    candidate_id,
    title: requireString(obj, "title", index),
    why: requireString(obj, "why", index),
    next_action: requireString(obj, "next_action", index),
  };
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  index: number,
): string {
  const v = obj[key];
  if (typeof v !== "string") {
    throw new Error(`picks[${index}].${key} must be a string`);
  }
  return v;
}
