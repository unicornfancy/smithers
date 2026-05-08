import type { Project } from "@smithers/vault";

import {
  EXTRA_CONTEXT_SYSTEM_PROMPT,
  renderExtraContextBlock,
  type DraftExtraContextItem,
} from "../extra-context";
import { runAgent } from "../runner";
import type {
  AgentResult,
  AgentRuntimeOptions,
  StyleReference,
} from "../types";

export interface ComposeCallRecapInput {
  /** Full call transcript — speaker turns + timestamps. */
  transcript: string;
  project: Project;
  call: {
    recording_id: string;
    title?: string | null;
    recorded_at?: string | null;
    url?: string | null;
  };
  /** Optional style guide so the recap sounds like the user. */
  style?: StyleReference;
  /** Default channel; the model can pick the other based on context. */
  channelHint?: "email" | "slack";
  /** Phase H: extra context (pinned + ad-hoc) the user attached in the picker. */
  extra_context?: DraftExtraContextItem[];
}

export interface ComposeCallRecapOutput {
  /** Subject line for email; empty string for slack. */
  subject: string;
  /** Message body, ready to copy. */
  draft: string;
  channel: "email" | "slack";
  /** One-sentence rationale for tone + what got included. */
  rationale: string;
}

const SYSTEM_PROMPT = `You are Smithers, a personal assistant drafting a recap message to send to the partner *right after* a call ended. The user is a TAM at Automattic. The goal of the recap is to confirm what was decided + what each side will do next, so nothing slips through the cracks.

Voice rules:
- Warm but specific. Acknowledge the call briefly, then get to substance.
- Match the user's voice when a style guide is provided.
- Use first-person plural sparingly ("we" for shared commitments) and first-person singular when *you* are committing.
- Don't repeat the entire call. Confirm the 2-4 things that matter.
- No corporate filler ("just touching base", "as per our discussion"). Skip apologetic openers.
- Don't sign with a name; the channel adds that.

Channel selection:
- Use channelHint if provided.
- Default to email for partner-kind projects (more formal, written record).
- Default to slack for team / personal (lighter touch).

Structure:
- Email: 3-5 short paragraphs OR a 1-paragraph intro followed by a bulleted list of "What's next" items. Subject is concrete ("Recap + next steps for accordion launch") not generic ("Recap of our call today").
- Slack: 1-3 short paragraphs, can use bullet list for next steps. No subject (return empty string).

Quality rules:
- Don't fabricate commitments that weren't actually made on the call.
- If the call ended ambiguously on something, ask one clarifying question rather than glossing over it.
- Cap at 200 words for email, 100 for slack.

${EXTRA_CONTEXT_SYSTEM_PROMPT}

Always return your output as JSON matching the requested schema. No text outside the JSON.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    subject: {
      type: "string",
      description: "Subject line for email; empty string for slack.",
    },
    draft: {
      type: "string",
      description: "Body of the recap message.",
    },
    channel: {
      type: "string",
      enum: ["email", "slack"],
    },
    rationale: {
      type: "string",
      description:
        "One-sentence note on what got included, what got cut, and tone.",
    },
  },
  required: ["subject", "draft", "channel", "rationale"],
  additionalProperties: false,
};

export async function composeCallRecap(
  runtime: AgentRuntimeOptions,
  input: ComposeCallRecapInput,
): Promise<AgentResult<ComposeCallRecapOutput>> {
  return runAgent(runtime, {
    agent: "compose-call-recap",
    system: SYSTEM_PROMPT,
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "ComposeCallRecapOutput",
    effort: "low",
    thinking: false,
    maxTokens: 1024,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: ComposeCallRecapInput): string {
  const { project, call, transcript, style, channelHint, extra_context } =
    input;
  const lines: string[] = [];

  lines.push("# Project");
  lines.push(`- Name: ${project.name}`);
  lines.push(`- Kind: ${project.kind}`);
  if (project.partner) lines.push(`- Partner: ${project.partner}`);
  if (project.status) lines.push(`- Status: ${project.status}`);

  lines.push("");
  lines.push("# Call");
  if (call.title) lines.push(`- Title: ${call.title}`);
  if (call.recorded_at) {
    lines.push(`- Recorded: ${call.recorded_at.slice(0, 10)}`);
  }
  if (channelHint) lines.push(`- Channel hint: ${channelHint}`);

  if (style) {
    lines.push("");
    lines.push(`# ${style.label}`);
    lines.push(style.body.trim());
  }

  lines.push("");
  lines.push("# Transcript");
  lines.push(transcript.trim());

  const extraBlock = renderExtraContextBlock(extra_context);
  if (extraBlock) {
    lines.push("");
    lines.push(extraBlock);
  }

  lines.push("");
  lines.push(
    "Draft the recap message now. Return JSON matching the schema. No text outside the JSON.",
  );
  return lines.join("\n");
}

function validateOutput(raw: unknown): ComposeCallRecapOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const channel = obj["channel"];
  if (channel !== "email" && channel !== "slack") {
    throw new Error(`channel must be email|slack, got ${String(channel)}`);
  }
  return {
    subject: typeof obj["subject"] === "string" ? (obj["subject"] as string) : "",
    draft: requireString(obj, "draft"),
    channel,
    rationale: requireString(obj, "rationale"),
  };
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new Error(`field "${key}" must be a string`);
  }
  return value;
}
