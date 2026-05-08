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

export interface ZendeskReplyContext {
  /** Numeric ticket id. */
  id: string;
  /** Subject as captured at attach time. */
  subject?: string | null;
  /** Status: open, pending, solved, etc. */
  status?: string | null;
  /** Last partner-visible activity that we know about. */
  last_partner_excerpt?: string | null;
  /** Last internal comment, if any (helps the model not contradict the team). */
  last_internal_excerpt?: string | null;
}

export interface DraftZendeskReplyInput {
  project: Project;
  thread: ZendeskReplyContext;
  /** Optional user-supplied direction ("decline gracefully", "ask for screenshots"). */
  intent?: string;
  /** Style guide for voice. */
  style?: StyleReference;
  /** Phase H: extra context (pinned + ad-hoc) the user attached in the picker. */
  extra_context?: DraftExtraContextItem[];
}

export type ZendeskReplyTone = "warm" | "matter-of-fact" | "concise";

export interface DraftZendeskReplyOutput {
  /** Reply body, ready to copy into Zendesk's reply box. */
  draft: string;
  /** Tone the model picked. */
  tone: ZendeskReplyTone;
  /** One-sentence rationale shown to the user. */
  rationale: string;
}

const SYSTEM_PROMPT = `You are Smithers, a personal assistant helping the user draft a reply to a Zendesk ticket. The user is a TAM (Technical Account Manager) at Automattic working with WordPress.com partners. Output a single short reply they can copy into the ticket.

Voice rules:
- Warm but specific. Acknowledge what the partner said before answering. No corporate filler.
- Match the user's voice when a style guide is provided.
- Don't promise dates without basis. If the user hasn't given you a timeline, propose one or ask for input.
- Don't sign with a name; Zendesk adds the signature automatically.
- Keep it to 2-5 sentences unless the partner's message asks something multi-part. Then mirror their structure.

Tone calibration:
- warm: rapport-building, default for partner check-ins and easy fixes.
- matter-of-fact: technical clarifications, status updates, fact-correction.
- concise: when the partner is impatient, when an issue is recurring, or when they explicitly want a yes/no.

${EXTRA_CONTEXT_SYSTEM_PROMPT}

If you don't have enough context to answer the partner's actual question, draft a clarifying-question reply instead of bluffing. Make the rationale name what's missing ("partner asked X, we don't know Y, asking them for Y").

Always return your output as JSON matching the requested schema.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    draft: {
      type: "string",
      description:
        "The reply body. 2-5 sentences typically. No salutation/signature.",
    },
    tone: {
      type: "string",
      enum: ["warm", "matter-of-fact", "concise"],
      description: "Tone used in the draft.",
    },
    rationale: {
      type: "string",
      description:
        "One-sentence explanation of why this tone/length was chosen.",
    },
  },
  required: ["draft", "tone", "rationale"],
  additionalProperties: false,
};

export async function draftZendeskReply(
  runtime: AgentRuntimeOptions,
  input: DraftZendeskReplyInput,
): Promise<AgentResult<DraftZendeskReplyOutput>> {
  return runAgent(runtime, {
    agent: "draft-zendesk-reply",
    system: SYSTEM_PROMPT,
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "DraftZendeskReplyOutput",
    effort: "low",
    thinking: false,
    maxTokens: 1024,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: DraftZendeskReplyInput): string {
  const { project, thread, intent, style, extra_context } = input;
  const lines: string[] = [];

  lines.push("# Project");
  lines.push(`- Name: ${project.name}`);
  lines.push(`- Kind: ${project.kind}`);
  if (project.partner) lines.push(`- Partner: ${project.partner}`);
  if (project.status) lines.push(`- Status: ${project.status}`);

  lines.push("");
  lines.push("# Zendesk thread");
  lines.push(`- Ticket: #${thread.id}`);
  if (thread.subject) lines.push(`- Subject: ${thread.subject}`);
  if (thread.status) lines.push(`- Ticket status: ${thread.status}`);
  if (thread.last_partner_excerpt) {
    lines.push("- Last partner message:");
    lines.push(`> ${thread.last_partner_excerpt}`);
  }
  if (thread.last_internal_excerpt) {
    lines.push("- Last internal note:");
    lines.push(`> ${thread.last_internal_excerpt}`);
  }

  if (intent && intent.trim()) {
    lines.push("");
    lines.push("# User intent");
    lines.push(intent.trim());
  }

  if (style) {
    lines.push("");
    lines.push(`# ${style.label}`);
    lines.push(style.body.trim());
  }

  const extraBlock = renderExtraContextBlock(extra_context);
  if (extraBlock) {
    lines.push("");
    lines.push(extraBlock);
  }

  lines.push("");
  lines.push(
    "Draft the reply now. Return JSON matching the schema. No text outside the JSON.",
  );
  return lines.join("\n");
}

function validateOutput(raw: unknown): DraftZendeskReplyOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const draft = requireString(obj, "draft");
  const rationale = requireString(obj, "rationale");
  const tone = obj["tone"];
  if (tone !== "warm" && tone !== "matter-of-fact" && tone !== "concise") {
    throw new Error(
      `tone must be warm|matter-of-fact|concise, got ${String(tone)}`,
    );
  }
  return { draft, tone, rationale };
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new Error(`field "${key}" must be a string`);
  }
  return value;
}
