import { attachJobContext } from "../job-context";
import { runAgent } from "../runner";
import type {
  AgentResult,
  AgentRuntimeOptions,
  JobContextRefs,
} from "../types";

export type HighlightCategory =
  | "launch"
  | "urgent-response"
  | "brief-or-handoff"
  | "decision"
  | "sustained-engagement"
  | "follow-up-resolved"
  | "call-processed";

export interface HighlightCandidateInput {
  category: HighlightCategory;
  title: string;
  context?: string;
  project_slug?: string;
  project_name?: string;
  occurred_at?: string;
}

export interface SuggestWeeklyHighlightsInput {
  iso_week: string;
  window_start: string;
  window_end: string;
  candidates: HighlightCandidateInput[];
  /**
   * Job-context refs the runner loads on the caller's behalf. Expected
   * slices: team_charter (rubric — what work is rewarded) and
   * job_context (role definition — what applies to this role). The
   * agent uses these to weigh candidates the role is actually scored
   * on more highly than incidental activity.
   */
  context?: JobContextRefs;
}

export interface WeeklyHighlightSuggestion {
  /** Short imperative title — what to write down. */
  title: string;
  /** One-sentence "why this matters" / why it's worth remembering. */
  why: string;
  /** Echo the source category so the UI can render a matching icon. */
  category: HighlightCategory;
  /** Optional project slug the suggestion is anchored to. */
  project_slug?: string;
}

export interface SuggestWeeklyHighlightsOutput {
  /** 0-5 picks, ranked by "worth remembering." */
  picks: WeeklyHighlightSuggestion[];
  /** One-sentence framing for the panel header. */
  framing: string;
}

const SYSTEM_PROMPT = `You are Smithers, helping the user pick what's worth remembering from a week. You're handed a list of pre-collected candidates from vault + activity signals; your job is to rank the 3-5 most meaningful and write a one-line title + one-sentence "why" for each.

Picking rules:
- Bias toward accomplishments and meaningful inflection points, not raw counts. "Body Dao Acupuncture launched" beats "you replied to 12 tickets" 9 times out of 10.
- A fast urgent response is a highlight when the partner was clearly waiting and you unblocked them — not when the inbound was a thank-you.
- A brief / handoff is a highlight when it represents a real artifact you shipped. Routine drafts (a one-line reply that happened to get archived) are not.
- Sustained engagement (many outbound replies) only makes the list when the project's status is hot/active and the volume was unusual for the partner.
- Decisions and follow-up resolutions are usually less memorable in isolation — include only if no stronger candidates exist.

If fewer than 3 strong candidates exist, return only the strong ones. It's fine to return 0 picks for a quiet week — the framing line should say so honestly.

Voice rules:
- Title: one line, declarative, past-tense. "Launched The Pocket NYC Phase 2." Not "Launching" or "Launch The Pocket NYC."
- Why: one sentence, specific, no filler. "First partner launch this quarter — closes a 4-month project." Not "Big milestone for the partner."
- Don't fabricate. If a candidate's context is thin, lean on the title and skip embellishment.

Always return JSON matching the requested schema. No prose outside the JSON.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    framing: {
      type: "string",
      description:
        "One sentence framing the week ('Big launch week.' / 'Steady — nothing stands out.' / etc).",
    },
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          why: { type: "string" },
          category: {
            type: "string",
            enum: [
              "launch",
              "urgent-response",
              "brief-or-handoff",
              "decision",
              "sustained-engagement",
              "follow-up-resolved",
              "call-processed",
            ],
          },
          project_slug: { type: "string" },
        },
        required: ["title", "why", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["framing", "picks"],
  additionalProperties: false,
};

export async function suggestWeeklyHighlights(
  runtime: AgentRuntimeOptions,
  input: SuggestWeeklyHighlightsInput,
): Promise<AgentResult<SuggestWeeklyHighlightsOutput>> {
  return runAgent(runtime, {
    agent: "suggest-weekly-highlights",
    system: attachJobContext(SYSTEM_PROMPT, input.context),
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "SuggestWeeklyHighlightsOutput",
    effort: "medium",
    thinking: false,
    maxTokens: 1024,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: SuggestWeeklyHighlightsInput): string {
  const lines: string[] = [];
  lines.push(`# Week`);
  lines.push(`- ID: ${input.iso_week}`);
  lines.push(`- Window: ${input.window_start} → ${input.window_end}`);
  lines.push("");
  lines.push(`# Candidates (${input.candidates.length})`);
  if (input.candidates.length === 0) {
    lines.push("(none — nothing on the signal list this week)");
  } else {
    for (const c of input.candidates) {
      const parts: string[] = [`[${c.category}]`, c.title];
      if (c.project_name) parts.push(`(${c.project_name})`);
      lines.push(`- ${parts.join(" ")}`);
      if (c.context) {
        for (const line of c.context.split("\n")) {
          lines.push(`    ${line.trim()}`);
        }
      }
      if (c.occurred_at) {
        lines.push(`    occurred_at: ${c.occurred_at}`);
      }
    }
  }
  lines.push("");
  lines.push(
    "Pick 0-5 most-worth-remembering moments. Title + one-sentence why per pick. Return JSON only.",
  );
  return lines.join("\n");
}

function validateOutput(raw: unknown): SuggestWeeklyHighlightsOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const framing = requireString(obj, "framing");
  const picksRaw = obj["picks"];
  if (!Array.isArray(picksRaw)) {
    throw new Error("picks must be an array");
  }
  const picks: WeeklyHighlightSuggestion[] = picksRaw
    .slice(0, 5)
    .map((p) => validatePick(p));
  return { framing, picks };
}

function validatePick(raw: unknown): WeeklyHighlightSuggestion {
  if (!raw || typeof raw !== "object") {
    throw new Error("pick is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const title = requireString(obj, "title");
  const why = requireString(obj, "why");
  const category = requireString(obj, "category") as HighlightCategory;
  return {
    title,
    why,
    category,
    project_slug:
      typeof obj["project_slug"] === "string"
        ? (obj["project_slug"] as string)
        : undefined,
  };
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string") throw new Error(`${key} must be a string`);
  return v;
}
