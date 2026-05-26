import type { Project } from "@smithers/vault";

import { runAgent } from "../runner";
import type { AgentResult, AgentRuntimeOptions } from "../types";

export interface SummarizeZendeskThreadComment {
  /** Display name (e.g. "Jane Partner") or email. */
  author: string;
  /** True when the commenter is external to Automattic. */
  is_external: boolean;
  /** ISO timestamp of the comment. */
  timestamp: string;
  /** Comment body, plain text. */
  body: string;
}

export interface SummarizeZendeskThreadInput {
  project?: Project;
  thread: {
    id: string;
    subject?: string | null;
    status?: string | null;
  };
  /** Ordered oldest → newest. The agent reads them that way. */
  comments: SummarizeZendeskThreadComment[];
}

export interface SummarizeZendeskThreadOutput {
  /**
   * Short markdown summary covering the partner's ask, key decisions or
   * blockers, current state, and what we owe them next. Typically 5-10
   * lines as bullet points or short paragraphs.
   */
  summary: string;
  /**
   * Quick one-liner stating what the user (TAM) needs to do next, if
   * anything. Empty string when the ball is in the partner's court.
   */
  next_step: string;
}

const SYSTEM_PROMPT = `You are Smithers, a personal assistant helping the user (a TAM at Automattic working with WordPress.com partners) get up to speed on a Zendesk thread quickly. The user has dozens of open tickets and doesn't have time to reread every comment.

Your job: produce a short, factual summary of the thread so the user can answer "what is this ticket and what do I owe them?" in 15 seconds.

What to cover (in this order, but only when relevant):
- The partner's original ask in one sentence.
- Key decisions, commitments, or blockers raised in the thread.
- Current state (waiting on partner, waiting on engineering, escalated, etc.).
- What the user owes the partner next, if anything.

Style rules:
- Use short bullet points (markdown "- " lines) or 1-2 short paragraphs. 5-10 lines total.
- Plain language. No corporate filler. No restating the ticket id or subject — the UI shows those already.
- Be specific. Names, dates, and concrete asks only — skip vague descriptions like "discussion continued".
- Don't speculate beyond what's in the thread. If something is unclear, say so.
- If the thread is solved/closed, summarize the resolution rather than treating it as open.

The "next_step" field is a single short sentence (or empty string when the ball is with the partner, engineering, or no one). Don't repeat the bullet content — just the most actionable next move for the user.

Always return your output as JSON matching the requested schema.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "Markdown summary, 5-10 lines, bullets or short paragraphs. Covers ask, decisions/blockers, state, and what we owe the partner.",
    },
    next_step: {
      type: "string",
      description:
        "One-sentence next action for the user. Empty string when the ball isn't in their court.",
    },
  },
  required: ["summary", "next_step"],
  additionalProperties: false,
};

export async function summarizeZendeskThread(
  runtime: AgentRuntimeOptions,
  input: SummarizeZendeskThreadInput,
): Promise<AgentResult<SummarizeZendeskThreadOutput>> {
  return runAgent(runtime, {
    agent: "summarize-thread",
    system: SYSTEM_PROMPT,
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "SummarizeZendeskThreadOutput",
    effort: "low",
    thinking: false,
    maxTokens: 1024,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: SummarizeZendeskThreadInput): string {
  const { project, thread, comments } = input;
  const lines: string[] = [];

  if (project) {
    lines.push("# Project");
    lines.push(`- Name: ${project.name}`);
    lines.push(`- Kind: ${project.kind}`);
    if (project.partner) lines.push(`- Partner: ${project.partner}`);
    if (project.status) lines.push(`- Status: ${project.status}`);
    lines.push("");
  }

  lines.push("# Zendesk thread");
  lines.push(`- Ticket: #${thread.id}`);
  if (thread.subject) lines.push(`- Subject: ${thread.subject}`);
  if (thread.status) lines.push(`- Ticket status: ${thread.status}`);

  lines.push("");
  lines.push("# Comments (oldest first)");
  if (comments.length === 0) {
    lines.push(
      "_No comments were available from Zendesk. Summarize what you can from the subject + status alone, and note in the summary that comment text wasn't fetchable._",
    );
  } else {
    for (const c of comments) {
      const who = `${c.author}${c.is_external ? " (partner)" : " (internal)"}`;
      lines.push(`## ${who} — ${c.timestamp}`);
      lines.push(c.body.trim());
      lines.push("");
    }
  }

  lines.push("");
  lines.push(
    "Summarize the thread now. Return JSON matching the schema. No text outside the JSON.",
  );
  return lines.join("\n");
}

function validateOutput(raw: unknown): SummarizeZendeskThreadOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const summary = requireString(obj, "summary");
  const nextStep = obj["next_step"];
  if (typeof nextStep !== "string") {
    throw new Error(`field "next_step" must be a string`);
  }
  return { summary, next_step: nextStep };
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new Error(`field "${key}" must be a string`);
  }
  return value;
}
