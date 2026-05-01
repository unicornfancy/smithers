import type { FollowUp, Project, ProjectTask } from "@smithers/vault";

import { runAgent } from "../runner";
import type {
  AgentResult,
  AgentRuntimeOptions,
  StyleReference,
} from "../types";

export interface SuggestNextStepZendeskThread {
  id: string;
  subject: string | null;
  status: string | null;
  updated_at: string | null;
}

export interface SuggestNextStepInput {
  project: Project;
  /** Active Zendesk threads (subject + status persisted in frontmatter). */
  zendeskThreads?: SuggestNextStepZendeskThread[];
  /** Active follow-ups for this project, with task text + sent date. */
  activeFollowUps?: FollowUp[];
  /** Open Items parsed from the project body. */
  openTasks?: ProjectTask[];
  /** Optional style guide so rationales sound like the user's voice. */
  style?: StyleReference;
  /** ISO date for "today" — useful for relative urgency reasoning. */
  today?: string;
}

export type SuggestNextStepCtaTarget =
  | { kind: "zendesk"; ticket_id: string }
  | { kind: "follow-up"; follow_up_id: string }
  | { kind: "open-item"; task_id: string }
  | { kind: "none" };

export interface SuggestNextStepPick {
  /** One-line action ("Reply to Martin on #11134851 about calendar dates"). */
  action: string;
  /** One-sentence why-this-now rationale shown under the action. */
  rationale: string;
  /**
   * Optional pointer back to a specific surface so the UI can render a
   * deep-link or scroll-to. The model picks the most relevant target;
   * "none" when the suggestion is project-level (e.g. "draft a P2 update").
   */
  target: SuggestNextStepCtaTarget;
}

export interface SuggestNextStepOutput {
  /** 1-3 picks ordered by what to tackle first. */
  picks: SuggestNextStepPick[];
  /**
   * One-sentence framing for the panel header — the user's daily
   * shape for *this project* in plain English.
   */
  framing: string;
}

const SYSTEM_PROMPT = `You are Smithers, a personal assistant helping the user pick the next concrete action on a single project. The user is opening this project's workbench and wants 1-3 specific things to do right now, not a general status report.

Picking the right action:
- Bias toward unblocking the partner. A waiting partner reply trumps internal cleanup.
- Prefer follow-ups whose due date has passed or is today.
- A Zendesk thread that's been quiet for 3+ days with the partner waiting on you is high priority.
- Open Items in the project body are usually internal work — surface only when they look blocking (e.g. mention "send", "reply", "ship").
- If the project is genuinely quiet and there's nothing time-sensitive, say so — return one project-level pick like "Draft a P2 status update" rather than fabricating urgency.

Voice rules:
- Each action must be specific enough to start in 30 seconds. "Reply to Martin on Zendesk #11134851 with the calendar fix timeline" — not "follow up on Zendesk".
- Rationales are one sentence. No filler. State the time pressure or unblock.
- Match the user's voice when a style guide is provided.
- Don't invent context not in the input. If you're not sure, say "Reply to {name} — needs a status update", not made-up specifics.

Targets:
- target.kind = "zendesk" with ticket_id when the action acts on a specific thread.
- target.kind = "follow-up" with follow_up_id when the action resolves a tracked follow-up row.
- target.kind = "open-item" with task_id when it ticks off a checkbox.
- target.kind = "none" for project-level picks (drafting, planning, brief writing).

Always return your output as JSON matching the requested schema. Don't return more than 3 picks.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    framing: {
      type: "string",
      description:
        "One-sentence shape of today on this project. Plain English.",
    },
    picks: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "Specific action the user can start in 30 seconds.",
          },
          rationale: {
            type: "string",
            description:
              "One sentence on why this action matters today.",
          },
          target: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: ["zendesk", "follow-up", "open-item", "none"],
              },
              ticket_id: { type: "string" },
              follow_up_id: { type: "string" },
              task_id: { type: "string" },
            },
            required: ["kind"],
            additionalProperties: false,
          },
        },
        required: ["action", "rationale", "target"],
        additionalProperties: false,
      },
    },
  },
  required: ["framing", "picks"],
  additionalProperties: false,
};

export async function suggestNextStep(
  runtime: AgentRuntimeOptions,
  input: SuggestNextStepInput,
): Promise<AgentResult<SuggestNextStepOutput>> {
  return runAgent(runtime, {
    agent: "suggest-next-step",
    system: SYSTEM_PROMPT,
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "SuggestNextStepOutput",
    effort: "medium",
    thinking: false,
    maxTokens: 1024,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: SuggestNextStepInput): string {
  const {
    project,
    zendeskThreads,
    activeFollowUps,
    openTasks,
    style,
    today,
  } = input;
  const lines: string[] = [];

  lines.push("# Project");
  lines.push(`- Name: ${project.name}`);
  lines.push(`- Slug: ${project.slug}`);
  lines.push(`- Kind: ${project.kind}`);
  lines.push(`- Status: ${project.status}`);
  if (project.partner) lines.push(`- Partner: ${project.partner}`);
  if (project.next_nudge) lines.push(`- Next nudge: ${project.next_nudge}`);
  if (today) lines.push(`- Today: ${today}`);

  if (zendeskThreads && zendeskThreads.length > 0) {
    lines.push("");
    lines.push("# Zendesk threads (active)");
    for (const t of zendeskThreads) {
      const parts = [`#${t.id}`, t.subject ?? "(no subject)"];
      if (t.status) parts.push(`status:${t.status}`);
      if (t.updated_at) parts.push(`updated:${t.updated_at.slice(0, 10)}`);
      lines.push(`- ${parts.join(" · ")}`);
    }
  }

  if (activeFollowUps && activeFollowUps.length > 0) {
    lines.push("");
    lines.push("# Active follow-ups");
    for (const f of activeFollowUps) {
      const parts: string[] = [`id:${f.follow_up_id}`];
      parts.push(f.task);
      if (f.sent) parts.push(`sent:${f.sent}`);
      if (f.follow_up_by) parts.push(`due:${f.follow_up_by}`);
      lines.push(`- ${parts.join(" · ")}`);
    }
  }

  if (openTasks && openTasks.length > 0) {
    lines.push("");
    lines.push("# Open Items (project body checkboxes)");
    for (const t of openTasks.slice(0, 20)) {
      const parts: string[] = [`id:${t.task_id}`, t.text];
      if (t.section) parts.push(`section:${t.section}`);
      lines.push(`- ${parts.join(" · ")}`);
    }
  }

  if (style) {
    lines.push("");
    lines.push(`# ${style.label}`);
    lines.push(style.body.trim());
  }

  lines.push("");
  lines.push(
    "Pick 1-3 next steps for this project. Return JSON matching the schema. No text outside the JSON.",
  );
  return lines.join("\n");
}

function validateOutput(raw: unknown): SuggestNextStepOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const framing = requireString(obj, "framing");
  const rawPicks = obj["picks"];
  if (!Array.isArray(rawPicks)) {
    throw new Error("picks must be an array");
  }
  const picks: SuggestNextStepPick[] = rawPicks.map(
    validatePick,
  );
  return { framing, picks };
}

function validatePick(raw: unknown): SuggestNextStepPick {
  if (!raw || typeof raw !== "object") {
    throw new Error("pick is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const action = requireString(obj, "action");
  const rationale = requireString(obj, "rationale");
  const target = validateTarget(obj["target"]);
  return { action, rationale, target };
}

function validateTarget(raw: unknown): SuggestNextStepCtaTarget {
  if (!raw || typeof raw !== "object") {
    throw new Error("target is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj["kind"];
  if (kind === "zendesk") {
    const ticket_id = requireString(obj, "ticket_id");
    return { kind: "zendesk", ticket_id };
  }
  if (kind === "follow-up") {
    const follow_up_id = requireString(obj, "follow_up_id");
    return { kind: "follow-up", follow_up_id };
  }
  if (kind === "open-item") {
    const task_id = requireString(obj, "task_id");
    return { kind: "open-item", task_id };
  }
  if (kind === "none") return { kind: "none" };
  throw new Error(
    `target.kind must be zendesk|follow-up|open-item|none, got ${String(kind)}`,
  );
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new Error(`field "${key}" must be a string`);
  }
  return value;
}
