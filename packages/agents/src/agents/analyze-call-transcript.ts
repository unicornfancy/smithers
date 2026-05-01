import type { Project } from "@smithers/vault";

import { runAgent } from "../runner";
import type {
  AgentResult,
  AgentRuntimeOptions,
  StyleReference,
} from "../types";

export interface AnalyzeCallTranscriptInput {
  /** Full transcript text — speaker turns + timestamps as Fathom emits them. */
  transcript: string;
  project: Project;
  /** Recording ref shown to the model so it can name the call in outputs. */
  call: {
    recording_id: string;
    title?: string | null;
    recorded_at?: string | null;
    url?: string | null;
  };
  /** Optional style guide so summaries / drafts sound like the user. */
  style?: StyleReference;
}

export interface CallActionItem {
  /** Single-line action ("Send Loom of staging accordion blocks to Martin"). */
  text: string;
  /** When the model is sure who owns the action ("user", "partner", or a name). */
  owner?: "user" | "partner" | "team" | "unknown";
}

export interface CallFollowUp {
  /** Task-style line that names what the user is waiting on. */
  task: string;
  /** YYYY-MM-DD when the user wants a reply, when stated or implied. */
  follow_up_by?: string;
  /** One-sentence why this needs a follow-up vs. an immediate action item. */
  rationale: string;
}

export interface CallDecision {
  /** Single-sentence decision in plain English. */
  text: string;
  /** Optional one-sentence rationale or "we picked X over Y because Z". */
  context?: string;
}

export interface CallKeyQuote {
  /** Speaker name as it appeared in the transcript (or "Partner" / "User"). */
  speaker: string;
  /** Quoted text — short, paste-friendly. */
  text: string;
}

export interface AnalyzeCallTranscriptOutput {
  /** 2-3 sentence executive summary, written in the user's voice. */
  summary: string;
  /** Concrete tasks the user should add to the project's Open Items. */
  action_items: CallActionItem[];
  /** Things the user is waiting on / will need to nudge later. */
  follow_ups: CallFollowUp[];
  /** Decisions reached during the call. */
  decisions: CallDecision[];
  /** Memorable partner quotes (or notable user commitments). */
  key_quotes: CallKeyQuote[];
}

const SYSTEM_PROMPT = `You are Smithers, a personal assistant analyzing the transcript of a recorded call. The user is a Technical Account Manager (TAM) at Automattic working with WordPress.com partners. Your job is to turn the transcript into a structured summary they can paste into project notes — and into discrete, actionable items they can drop into their workflow.

Five sections:

1. summary — 2-3 sentence TL;DR, plain English, written in the user's voice. Don't editorialize; describe what happened.
2. action_items — concrete things to do. Each must be specific enough to start in 30 seconds. Owner is "user" when the user committed to doing it, "partner" when the partner committed, "team" when a teammate committed, "unknown" when not stated. Skip soft suggestions ("we should think about X") — only include real commitments.
3. follow_ups — things the user is waiting on or wants a reply about later. These differ from action_items in that the user isn't doing the work; they're tracking when to nudge. Always include a one-sentence rationale.
4. decisions — concrete decisions reached. Skip exploration / hand-waving. Include the why when stated.
5. key_quotes — 1-3 short, memorable partner statements (or notable user commitments). Skip filler.

Quality rules:
- Don't fabricate. If the call doesn't include action items, return an empty array.
- Don't double-count. If something is both an action and a follow-up, put it where it fits best (typically action when the user is doing it, follow-up when they're waiting).
- Use names from the transcript when available; otherwise "user", "partner", "team".
- Quotes must be exact words from the transcript — paraphrase elsewhere.
- For follow_up_by dates: only fill in when the partner committed to a specific date or "next week" / "by Friday" was said. Otherwise leave blank.

Always return your output as JSON matching the requested schema. No text outside the JSON.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "2-3 sentence TL;DR of the call.",
    },
    action_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          owner: {
            type: "string",
            enum: ["user", "partner", "team", "unknown"],
          },
        },
        required: ["text", "owner"],
        additionalProperties: false,
      },
    },
    follow_ups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task: { type: "string" },
          follow_up_by: {
            type: "string",
            description: "YYYY-MM-DD or empty string.",
          },
          rationale: { type: "string" },
        },
        required: ["task", "follow_up_by", "rationale"],
        additionalProperties: false,
      },
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          context: { type: "string" },
        },
        required: ["text", "context"],
        additionalProperties: false,
      },
    },
    key_quotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          speaker: { type: "string" },
          text: { type: "string" },
        },
        required: ["speaker", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "action_items", "follow_ups", "decisions", "key_quotes"],
  additionalProperties: false,
};

export async function analyzeCallTranscript(
  runtime: AgentRuntimeOptions,
  input: AnalyzeCallTranscriptInput,
): Promise<AgentResult<AnalyzeCallTranscriptOutput>> {
  return runAgent(runtime, {
    agent: "analyze-call-transcript",
    system: SYSTEM_PROMPT,
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "AnalyzeCallTranscriptOutput",
    effort: "medium",
    thinking: false,
    maxTokens: 4096,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: AnalyzeCallTranscriptInput): string {
  const { project, call, transcript, style } = input;
  const lines: string[] = [];

  lines.push("# Project");
  lines.push(`- Name: ${project.name}`);
  lines.push(`- Kind: ${project.kind}`);
  if (project.partner) lines.push(`- Partner: ${project.partner}`);

  lines.push("");
  lines.push("# Call");
  if (call.title) lines.push(`- Title: ${call.title}`);
  if (call.recorded_at) {
    lines.push(`- Recorded: ${call.recorded_at.slice(0, 10)}`);
  }
  lines.push(`- Recording id: ${call.recording_id}`);

  if (style) {
    lines.push("");
    lines.push(`# ${style.label}`);
    lines.push(style.body.trim());
  }

  lines.push("");
  lines.push("# Transcript");
  lines.push(transcript.trim());

  lines.push("");
  lines.push(
    "Analyze the transcript above. Return JSON matching the schema. No text outside the JSON.",
  );
  return lines.join("\n");
}

function validateOutput(raw: unknown): AnalyzeCallTranscriptOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  return {
    summary: requireString(obj, "summary"),
    action_items: validateArray(obj["action_items"], validateActionItem),
    follow_ups: validateArray(obj["follow_ups"], validateFollowUp),
    decisions: validateArray(obj["decisions"], validateDecision),
    key_quotes: validateArray(obj["key_quotes"], validateKeyQuote),
  };
}

function validateArray<T>(raw: unknown, validate: (v: unknown) => T): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(validate);
}

function validateActionItem(raw: unknown): CallActionItem {
  if (!raw || typeof raw !== "object") {
    throw new Error("action_item is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const text = requireString(obj, "text");
  const owner = obj["owner"];
  if (
    owner !== "user" &&
    owner !== "partner" &&
    owner !== "team" &&
    owner !== "unknown"
  ) {
    throw new Error(`owner must be user|partner|team|unknown, got ${String(owner)}`);
  }
  return { text, owner };
}

function validateFollowUp(raw: unknown): CallFollowUp {
  if (!raw || typeof raw !== "object") {
    throw new Error("follow_up is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const task = requireString(obj, "task");
  const rationale = requireString(obj, "rationale");
  const dueRaw = obj["follow_up_by"];
  const follow_up_by =
    typeof dueRaw === "string" && dueRaw.trim() ? dueRaw.trim() : undefined;
  return { task, rationale, follow_up_by };
}

function validateDecision(raw: unknown): CallDecision {
  if (!raw || typeof raw !== "object") {
    throw new Error("decision is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const text = requireString(obj, "text");
  const ctxRaw = obj["context"];
  const context =
    typeof ctxRaw === "string" && ctxRaw.trim() ? ctxRaw.trim() : undefined;
  return { text, context };
}

function validateKeyQuote(raw: unknown): CallKeyQuote {
  if (!raw || typeof raw !== "object") {
    throw new Error("key_quote is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const speaker = requireString(obj, "speaker");
  const text = requireString(obj, "text");
  return { speaker, text };
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new Error(`field "${key}" must be a string`);
  }
  return value;
}
