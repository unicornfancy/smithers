import type { FollowUp, Project } from "@smithers/vault";

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

export type NudgeTone = "soft" | "direct" | "force-decide";
export type NudgeChannel = "email" | "slack";

export interface ComposeNudgeInput {
  followUp: FollowUp;
  /** Project the follow-up belongs to, when one was matched. Improves tone calibration. */
  project?: Project;
  /** Number of days the follow-up has been waiting; computed by the caller. */
  daysWaiting?: number;
  /** Optional style guide so drafts sound like the user. */
  style?: StyleReference;
  /**
   * Override the tone the model picks. Default behavior: model decides
   * based on `daysWaiting` (soft <14, direct 14-21, force-decide 21+).
   */
  toneOverride?: NudgeTone;
  /** Default channel; the model can override based on context. */
  channelHint?: NudgeChannel;
  /** Phase H: extra context (pinned + ad-hoc) the user attached in the picker. */
  extra_context?: DraftExtraContextItem[];
  /**
   * Free-form steering string from the picker: what this nudge should
   * be about / what tone to hit. Surfaces in the prompt as a "User
   * intent" section the model honors over its default tone heuristic.
   */
  user_intent?: string;
}

export interface ComposeNudgeOutput {
  /** Final draft text, ready to copy into the channel. */
  draft: string;
  /** Subject line if channel === "email"; empty for Slack. */
  subject: string;
  /** Channel the model picked (may differ from channelHint). */
  channel: NudgeChannel;
  /** Tone the model used. */
  tone: NudgeTone;
  /** One-sentence rationale for the chosen tone/length, surfaced in the UI. */
  rationale: string;
}

const SYSTEM_PROMPT = `You are Smithers, a personal assistant helping the user write follow-up nudges to partners and teammates. Your job is to draft a single short message they can send today.

Voice rules:
- Sound like a thoughtful professional, not a robot. No corporate filler.
- Match the user's existing voice when a style guide is provided.
- Acknowledge that time has passed; don't pretend it hasn't.
- Be specific about what you're following up on. Reference the original ask.
- Keep it short. Email: 2-4 sentences. Slack: 1-2 sentences.
- Never apologize for following up — that signals the message is annoying.
- Don't sign with the user's name; the channel adds that automatically.

Tone calibration (default, override only when toneOverride is set):
- soft (<14 days waiting): "Just circling back on X — let me know if you need anything from me."
- direct (14-21 days): "Following up on X — what's a good time to land this?"
- force-decide (21+ days): Names the stall and asks for an explicit answer or a date.

Channel selection:
- Use channelHint if provided.
- Otherwise: Slack for internal/teammate threads, email for external partners.

${EXTRA_CONTEXT_SYSTEM_PROMPT}

Always return your output as JSON matching the requested schema. Include a one-sentence rationale that explains your tone and length choice.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    draft: {
      type: "string",
      description: "The draft message body, ready to copy.",
    },
    subject: {
      type: "string",
      description: 'Subject line for email; empty string ("") for Slack.',
    },
    channel: {
      type: "string",
      enum: ["email", "slack"],
      description: "Channel the message is intended for.",
    },
    tone: {
      type: "string",
      enum: ["soft", "direct", "force-decide"],
      description: "Tone used in the draft.",
    },
    rationale: {
      type: "string",
      description:
        "One-sentence explanation of why this tone/length was chosen. Will be shown to the user.",
    },
  },
  required: ["draft", "subject", "channel", "tone", "rationale"],
  additionalProperties: false,
};

export async function composeFollowUpNudge(
  runtime: AgentRuntimeOptions,
  input: ComposeNudgeInput,
): Promise<AgentResult<ComposeNudgeOutput>> {
  return runAgent(runtime, {
    agent: "compose-followup-nudge",
    system: SYSTEM_PROMPT,
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "ComposeNudgeOutput",
    effort: "low",
    thinking: false,
    maxTokens: 1024,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: ComposeNudgeInput): string {
  const {
    followUp,
    project,
    daysWaiting,
    style,
    toneOverride,
    channelHint,
    extra_context,
    user_intent,
  } = input;
  const lines: string[] = [];

  lines.push("# Follow-up to nudge");
  lines.push(`- Project: ${followUp.project}`);
  if (project) {
    if (project.partner) lines.push(`- Partner: ${project.partner}`);
    lines.push(`- Project kind: ${project.kind}`);
    lines.push(`- Project status: ${project.status}`);
  }
  lines.push(`- Original ask: ${followUp.task}`);
  lines.push(`- Sent: ${followUp.sent}`);
  if (followUp.follow_up_by) {
    lines.push(`- Follow-up was due: ${followUp.follow_up_by}`);
  }
  if (typeof daysWaiting === "number") {
    lines.push(`- Days waiting: ${daysWaiting}`);
  }
  if (followUp.status_note) {
    lines.push(`- Status note: ${followUp.status_note}`);
  }
  if (toneOverride) {
    lines.push(`- Tone override (use this exact tone): ${toneOverride}`);
  }
  if (channelHint) {
    lines.push(`- Channel hint: ${channelHint}`);
  }

  if (style) {
    lines.push("");
    lines.push(`# ${style.label}`);
    lines.push(style.body.trim());
  }

  if (user_intent && user_intent.trim()) {
    lines.push("");
    lines.push("# User intent");
    lines.push(user_intent.trim());
    lines.push(
      "Honor this intent over the default tone heuristic — it represents what the user is actually trying to do with this message.",
    );
  }

  const extraBlock = renderExtraContextBlock(extra_context);
  if (extraBlock) {
    lines.push("");
    lines.push(extraBlock);
  }

  lines.push("");
  lines.push(
    "Draft the nudge now. Return JSON matching the schema. Do not include any text outside the JSON.",
  );

  return lines.join("\n");
}

function validateOutput(raw: unknown): ComposeNudgeOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const draft = requireString(obj, "draft");
  const subject = typeof obj.subject === "string" ? obj.subject : "";
  const channel = obj.channel;
  if (channel !== "email" && channel !== "slack") {
    throw new Error(`channel must be "email" or "slack", got ${String(channel)}`);
  }
  const tone = obj.tone;
  if (tone !== "soft" && tone !== "direct" && tone !== "force-decide") {
    throw new Error(`tone must be soft|direct|force-decide, got ${String(tone)}`);
  }
  const rationale = requireString(obj, "rationale");
  return { draft, subject, channel, tone, rationale };
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new Error(`field "${key}" must be a string`);
  }
  return value;
}
