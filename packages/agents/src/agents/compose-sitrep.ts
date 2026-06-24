import type { Project } from "@smithers/vault";

import { attachJobContext } from "../job-context";
import { runAgent } from "../runner";
import type {
  AgentResult,
  AgentRuntimeOptions,
  JobContextRefs,
  StyleReference,
} from "../types";

/**
 * Project signal bundle — caller flattens the workbench's MCP-side
 * shapes into this thinner format so the agent prompt isn't dragging
 * full Ping / LinearProject / Activity objects through.
 */
export interface SitrepInput {
  project: Project;
  /** Posting context: ISO date the SITREP is being written for. */
  iso_date: string;
  /** Linear project metadata (state, health, progress, target date), when linked. */
  linear?: {
    state?: string;
    health?: string;
    progress?: number;
    target_date?: string | null;
    url?: string;
  };
  /** Most recent Linear project updates (max ~5), oldest first. */
  linear_updates?: Array<{
    created_at: string;
    body: string;
    health?: string;
    author?: string;
  }>;
  /** Open Linear issues — title + assignee + state. */
  linear_open_issues?: Array<{
    identifier: string;
    title: string;
    state?: string;
    assignee?: string;
  }>;
  /** Open GitHub issues in the project's repo, when linked. */
  github_open_issues?: Array<{
    title: string;
    number: number;
    url: string;
    updated_at: string;
  }>;
  /** Primary Zendesk thread (first attached ticket). */
  primary_zendesk?: {
    id: string;
    subject?: string;
    status?: string;
    url: string;
  };
  /** Recent comments on the primary Zendesk thread, oldest first. */
  primary_zendesk_recent_activity?: Array<{
    timestamp: string;
    actor: string;
    excerpt: string;
  }>;
  /** Vault-tracked open follow-ups for this project. */
  follow_ups?: Array<{
    task: string;
    sent?: string;
    follow_up_by?: string;
  }>;
  /** Optional style reference so the SITREP matches the user's voice. */
  style?: StyleReference;
  /** Optional job-context refs (operating_rhythm at minimum). */
  context?: JobContextRefs;
  /** Free-form steering: anything the user wants the SITREP to focus on. */
  user_intent?: string;
}

export interface SitrepOutput {
  /** Markdown body — paste-ready as a P2 comment on the project's post. */
  body: string;
  /** One-line rationale describing what got included and what got cut. */
  rationale: string;
}

const SYSTEM_PROMPT = `You are Smithers, drafting a SITREP (Situation Report) as a top-level P2 comment on the project's existing P2 post. SITREPs help leads and coverage TAMs catch up on a project's current state at a glance.

Audience + voice:
- Other TAMs / leads who may need to cover this project. Internal-only.
- Concise, professional, present-tense. Sound like a TAM giving teammates a status update.
- Match the user's voice when a style guide is provided. Don't sign — P2 attaches the author.

Required structure (in this order, as a single markdown comment body):
1. **Status one-liner.** Bold-prefixed health snapshot, e.g. "**Status:** On track — phase 2 build, 60% complete." Pull from Linear state/health when available; fall back to project frontmatter. When a Linear project URL is present in the input, append it as a markdown link at the end of the line — e.g. "… 60% complete. [Linear project](https://linear.app/...)". Omit the link entirely when no URL is provided.
2. **Latest activity.** 2-3 sentences summarizing what's moved in the last week. Use Linear updates, recent Zendesk replies, GitHub PR/issue activity. Cite specifics (decisions, ships, blockers) — not "we had a meeting".
3. **Primary Zendesk thread.** If present, render as a single markdown link: \`[Subject](url) — status\`. Use the provided primary_zendesk fields.
4. **Open items / what's next.** Bullet list (3-6 items) of concrete next actions. Pull from follow-ups, open Linear issues, and what's clearly outstanding from recent activity. Each bullet should be actionable, not aspirational.

Length: 150-300 words total. Tight. A coverage TAM should be able to read it in under a minute.

Quality rules:
- Don't fabricate. If a section has no signal (e.g. no Linear updates, no open GitHub issues), say so briefly ("No new GitHub activity this period") or skip it rather than invent.
- Don't include items the user owns privately that aren't appropriate to post (drafts, personal notes). Use only the provided inputs.
- Don't editorialize the partner unfavorably. Stick to facts.
- Don't repeat the project name in every section header — P2 already shows the context.

Always return JSON matching the requested schema. No prose outside the JSON.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    body: {
      type: "string",
      description:
        "Markdown body of the SITREP comment, ready to paste into the P2 comment composer.",
    },
    rationale: {
      type: "string",
      description:
        "One-sentence explanation of what got included and what got cut.",
    },
  },
  required: ["body", "rationale"],
  additionalProperties: false,
};

export async function composeSitrep(
  runtime: AgentRuntimeOptions,
  input: SitrepInput,
): Promise<AgentResult<SitrepOutput>> {
  return runAgent(runtime, {
    agent: "compose-sitrep",
    system: attachJobContext(SYSTEM_PROMPT, input.context),
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "SitrepOutput",
    effort: "medium",
    thinking: false,
    maxTokens: 2048,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: SitrepInput): string {
  const lines: string[] = [];

  lines.push("# Project");
  lines.push(`- Name: ${input.project.name}`);
  lines.push(`- Kind: ${input.project.kind}`);
  if (input.project.partner) lines.push(`- Partner: ${input.project.partner}`);
  if (input.project.status) lines.push(`- Status: ${input.project.status}`);
  lines.push(`- SITREP date: ${input.iso_date}`);

  if (input.linear) {
    lines.push("");
    lines.push("# Linear project");
    if (input.linear.state) lines.push(`- State: ${input.linear.state}`);
    if (input.linear.health) lines.push(`- Health: ${input.linear.health}`);
    if (typeof input.linear.progress === "number") {
      lines.push(`- Progress: ${Math.round(input.linear.progress * 100)}%`);
    }
    if (input.linear.target_date) {
      lines.push(`- Target date: ${input.linear.target_date}`);
    }
    if (input.linear.url) lines.push(`- URL: ${input.linear.url}`);
  }

  if (input.linear_updates && input.linear_updates.length > 0) {
    lines.push("");
    lines.push("# Recent Linear updates");
    for (const u of input.linear_updates) {
      const head = `- (${u.created_at.slice(0, 10)})${u.author ? ` ${u.author}` : ""}${u.health ? ` · ${u.health}` : ""}`;
      lines.push(head);
      for (const line of u.body.split("\n")) {
        if (line.trim()) lines.push(`    ${line.trim()}`);
      }
    }
  }

  if (input.linear_open_issues && input.linear_open_issues.length > 0) {
    lines.push("");
    lines.push("# Open Linear issues");
    for (const i of input.linear_open_issues) {
      const parts = [`${i.identifier}`, i.title];
      if (i.state) parts.push(`[${i.state}]`);
      if (i.assignee) parts.push(`(${i.assignee})`);
      lines.push(`- ${parts.join(" ")}`);
    }
  }

  if (input.github_open_issues && input.github_open_issues.length > 0) {
    lines.push("");
    lines.push("# Open GitHub issues");
    for (const i of input.github_open_issues) {
      lines.push(
        `- #${i.number} ${i.title} (updated ${i.updated_at.slice(0, 10)})`,
      );
    }
  }

  if (input.primary_zendesk) {
    lines.push("");
    lines.push("# Primary Zendesk thread");
    lines.push(`- ID: ${input.primary_zendesk.id}`);
    if (input.primary_zendesk.subject) {
      lines.push(`- Subject: ${input.primary_zendesk.subject}`);
    }
    if (input.primary_zendesk.status) {
      lines.push(`- Status: ${input.primary_zendesk.status}`);
    }
    lines.push(`- URL: ${input.primary_zendesk.url}`);
  }

  if (
    input.primary_zendesk_recent_activity &&
    input.primary_zendesk_recent_activity.length > 0
  ) {
    lines.push("");
    lines.push("# Primary Zendesk thread — recent activity");
    for (const a of input.primary_zendesk_recent_activity) {
      lines.push(
        `- (${a.timestamp.slice(0, 10)}) ${a.actor}: ${a.excerpt.slice(0, 280)}`,
      );
    }
  }

  if (input.follow_ups && input.follow_ups.length > 0) {
    lines.push("");
    lines.push("# Open follow-ups (vault)");
    for (const f of input.follow_ups) {
      const meta = [
        f.sent ? `sent ${f.sent.slice(0, 10)}` : null,
        f.follow_up_by ? `due ${f.follow_up_by}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      lines.push(`- ${f.task}${meta ? ` (${meta})` : ""}`);
    }
  }

  if (input.style) {
    lines.push("");
    lines.push(`# ${input.style.label}`);
    lines.push(input.style.body.trim());
  }

  if (input.user_intent && input.user_intent.trim()) {
    lines.push("");
    lines.push("# User intent");
    lines.push(input.user_intent.trim());
    lines.push(
      "Bias the SITREP toward this intent — what the user wants the coverage TAM / lead to actually do with this report.",
    );
  }

  lines.push("");
  lines.push(
    "Draft the SITREP now. Return JSON matching the schema. No text outside the JSON.",
  );
  return lines.join("\n");
}

function validateOutput(raw: unknown): SitrepOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  return {
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
