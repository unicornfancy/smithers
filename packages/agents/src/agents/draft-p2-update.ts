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

export interface DraftP2UpdateInput {
  /** Full call transcript — speaker turns + timestamps. */
  transcript: string;
  project: Project;
  /** Recording ref shown to the model so it can name the call in outputs. */
  call: {
    recording_id: string;
    title?: string | null;
    recorded_at?: string | null;
    url?: string | null;
  };
  /** Optional style guide so the post sounds like the user. */
  style?: StyleReference;
  /** Phase H: extra context (pinned + ad-hoc) the user attached in the picker. */
  extra_context?: DraftExtraContextItem[];
  /**
   * Free-form steering string from the picker: what the user actually
   * wants this update to communicate. Rendered into the prompt as a
   * "User intent" section the model honors over inference from the
   * call transcript alone.
   */
  user_intent?: string;
}

export interface DraftP2UpdateOutput {
  /** Suggested post title (will appear at top of P2 post). */
  title: string;
  /** Markdown body — ready to paste into a P2 new-post composer. */
  body: string;
  /** One-sentence rationale for what got cut and what got included. */
  rationale: string;
}

const SYSTEM_PROMPT = `You are Smithers, a personal assistant drafting a P2 status post from a call transcript. P2 is Automattic's internal blogging platform — short, scannable, written in a friendly professional voice. Your draft will be posted to the project's P2 so teammates know what was discussed and decided.

Voice rules:
- Sound like a TAM giving teammates a status update. Not formal, not chatty.
- Match the user's voice when a style guide is provided.
- Lead with what changed or what was decided. Not "we had a great call".
- Use markdown — short paragraphs, occasional bullet lists. No huge walls of text.
- Don't quote the partner verbatim unless the quote is the whole point. Paraphrase.
- Don't sign with the user's name; P2 attaches the author automatically.

Structure:
- 1-line title that names the topic, not the date or call name.
- Body, 100-300 words depending on call length:
  - Open with the headline (decision / status change / risk).
  - Brief context if a teammate joining cold needs it.
  - Bullet list of decisions or commitments made on the call.
  - Close with what's next + when the next check-in is.

Quality rules:
- Don't fabricate. If the call didn't include a decision, don't manufacture one.
- Don't include action items the user owns — those go in their own surface, not on a public P2.
- Don't post-mortem; this is a forward-looking status, not a transcript summary.

${EXTRA_CONTEXT_SYSTEM_PROMPT}

Always return your output as JSON matching the requested schema. No text outside the JSON.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "1-line title for the P2 post.",
    },
    body: {
      type: "string",
      description:
        "Markdown body of the post (100-300 words typically).",
    },
    rationale: {
      type: "string",
      description:
        "One-sentence explanation of what got included and what got cut.",
    },
  },
  required: ["title", "body", "rationale"],
  additionalProperties: false,
};

export async function draftP2Update(
  runtime: AgentRuntimeOptions,
  input: DraftP2UpdateInput,
): Promise<AgentResult<DraftP2UpdateOutput>> {
  return runAgent(runtime, {
    agent: "draft-p2-update",
    system: SYSTEM_PROMPT,
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "DraftP2UpdateOutput",
    effort: "medium",
    thinking: false,
    maxTokens: 2048,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: DraftP2UpdateInput): string {
  const { project, call, transcript, style, extra_context, user_intent } =
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

  if (style) {
    lines.push("");
    lines.push(`# ${style.label}`);
    lines.push(style.body.trim());
  }

  lines.push("");
  lines.push("# Transcript");
  lines.push(transcript.trim());

  if (user_intent && user_intent.trim()) {
    lines.push("");
    lines.push("# User intent");
    lines.push(user_intent.trim());
    lines.push(
      "Use this to frame the update — what the user actually wants the team to learn / decide / do.",
    );
  }

  const extraBlock = renderExtraContextBlock(extra_context);
  if (extraBlock) {
    lines.push("");
    lines.push(extraBlock);
  }

  lines.push("");
  lines.push(
    "Draft the P2 post now. Return JSON matching the schema. No text outside the JSON.",
  );
  return lines.join("\n");
}

function validateOutput(raw: unknown): DraftP2UpdateOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  return {
    title: requireString(obj, "title"),
    body: requireString(obj, "body"),
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
