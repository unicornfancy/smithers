import { runAgent } from "../runner";
import type { AgentResult, AgentRuntimeOptions } from "../types";

/**
 * Slim summary of a palette entry — just enough for the agent to match
 * a free-form query against the user's vault + HM. We don't ship full
 * frontmatter or recent activity; the agent only needs to identify which
 * entry the user means.
 */
export interface InterpretPaletteEntry {
  id: string;
  kind:
    | "project-vault"
    | "partner-hm"
    | "project-hm"
    | "page"
    | "follow-up";
  label: string;
  description?: string;
  project_slug?: string;
  partner_slug?: string;
  href?: string;
}

export interface InterpretPaletteOpenTaskHint {
  task_id: string;
  text: string;
  project_slug: string;
}

export interface InterpretPaletteOpenFollowUpHint {
  follow_up_id: string;
  task: string;
  project: string;
}

export interface InterpretPaletteQueryInput {
  query: string;
  /**
   * The unified palette index from /api/palette-index — agent picks one
   * entry by id. Trimmed to ~150 entries upstream so the system prompt
   * stays cache-friendly.
   */
  entries: InterpretPaletteEntry[];
  /**
   * Open tasks across all vault projects, lifted into the prompt only
   * when the query smells like a "mark X done" intent. The action layer
   * decides this — empty array is fine.
   */
  open_tasks?: InterpretPaletteOpenTaskHint[];
  /** Open follow-ups. Same idea — present when relevant, empty otherwise. */
  open_follow_ups?: InterpretPaletteOpenFollowUpHint[];
  /** ISO date for "today" so relative dates ("next week") resolve correctly. */
  today?: string;
}

export type InterpretPaletteIntentKind =
  | "navigate"
  | "add-task"
  | "add-follow-up"
  | "view-status"
  | "set-status"
  | "attach-zendesk"
  | "mark-task-done"
  | "resolve-follow-up"
  | "snooze-follow-up"
  | "unknown";

export interface InterpretPaletteQueryOutput {
  /** The action the agent thinks the user wants. */
  intent: InterpretPaletteIntentKind;
  /**
   * The palette entry id the action acts on. Required for every intent
   * except "unknown". For follow-up intents, this is the follow-up entry's
   * id (kind=follow-up). For project-scoped intents, it's the project entry.
   */
  entry_id?: string;
  /** Params per intent — flat object so validation is cheap. */
  task_text?: string;
  /** YYYY-MM-DD. */
  follow_up_by?: string;
  /**
   * Project status target. Must match one of the vault's enum values:
   * research, planning, active, hot, secondary, cold, at-risk, launched, archived.
   */
  status?: string;
  ticket_id?: string;
  /** task_id from open_tasks input. */
  task_id?: string;
  /** follow_up_id from open_follow_ups input. */
  follow_up_id?: string;
  /** Snooze duration in days. */
  snooze_days?: number;
  /** One-sentence sentence shown to the user before they confirm. */
  confirmation: string;
  /** 0..1 — the action layer routes <0.5 to a "couldn't parse" UI. */
  confidence: number;
}

const SYSTEM_PROMPT = `You are Smithers's palette interpreter. The user typed a free-form query into a command palette. Your job: pick one structured action to run, fill in its params, and produce a one-sentence confirmation the user will see before you actually do it.

Available intents:
- navigate — open a page, project, or partner. Use when the query is just a name with no verb.
- add-task — append a new task to a vault project's Open Items.
- add-follow-up — log a new follow-up (waiting on someone) against a vault project.
- view-status — show status + metrics for a vault project (no mutation).
- set-status — change a vault project's status. Valid values: research, planning, active, hot, secondary, cold, at-risk, launched, archived.
- attach-zendesk — attach a Zendesk ticket id to a vault project.
- mark-task-done — tick off an open task on a vault project. You must match against the provided open_tasks list when possible.
- resolve-follow-up — mark an open follow-up resolved. Match against open_follow_ups.
- snooze-follow-up — push a follow-up's "follow-up by" date forward by N days.
- unknown — when nothing matches confidently, return unknown with confidence 0.

How to pick:
- Verbs win. "add task to X" → add-task. "what's the status of X" → view-status. "snooze the X follow-up" → snooze-follow-up. "mark X done" → mark-task-done. "set X to launched" → set-status with status="launched".
- The entry_id MUST be one of the ids in the entries list. Don't invent ids.
- Project-scoped intents (add-task, add-follow-up, view-status, set-status, attach-zendesk, mark-task-done) require a project-vault entry. If the matching project is project-hm only (not in vault), fall back to navigate.
- For mark-task-done: pick task_id from open_tasks whose text best matches the query. If no good match, fall back to navigate.
- For resolve-follow-up / snooze-follow-up: pick follow_up_id from open_follow_ups whose task best matches the query. Snooze without an explicit duration defaults to 7 days.
- For add-task / add-follow-up: extract the task text after the colon, "to", or "with". Trim leading filler ("respond to martin", not "to respond to martin").
- For attach-zendesk: ticket_id is a numeric string (e.g. "11134851").
- For status: only the enum values above. "mark X done" is NOT set-status — that's mark-task-done.

Confirmation rules:
- One sentence, plain English, no trailing period required.
- Start with the verb in first person: "I'll add 'respond to martin' as a task on The Pocket NYC." or "Marking the Linear cleanup task done in Body Dao Acupuncture."
- For view-status / navigate, phrase as "Opening …".
- Don't promise side-effects you weren't asked for. Don't mention dates the user didn't say.

Confidence:
- 0.9+ when the verb is clear and the entry is unambiguous.
- 0.6-0.8 when you had to guess between two entries or filled in a default (e.g. snooze defaulted to 7 days).
- <0.5 when you're not sure — prefer "unknown" over a confident wrong answer.

Always return JSON matching the schema. No prose outside the JSON.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "navigate",
        "add-task",
        "add-follow-up",
        "view-status",
        "set-status",
        "attach-zendesk",
        "mark-task-done",
        "resolve-follow-up",
        "snooze-follow-up",
        "unknown",
      ],
    },
    entry_id: { type: "string" },
    task_text: { type: "string" },
    follow_up_by: { type: "string" },
    status: {
      type: "string",
      enum: [
        "research",
        "planning",
        "active",
        "hot",
        "secondary",
        "cold",
        "at-risk",
        "launched",
        "archived",
      ],
    },
    ticket_id: { type: "string" },
    task_id: { type: "string" },
    follow_up_id: { type: "string" },
    snooze_days: { type: "number" },
    confirmation: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["intent", "confirmation", "confidence"],
  additionalProperties: false,
};

export async function interpretPaletteQuery(
  runtime: AgentRuntimeOptions,
  input: InterpretPaletteQueryInput,
): Promise<AgentResult<InterpretPaletteQueryOutput>> {
  return runAgent(runtime, {
    agent: "interpret-palette-query",
    system: SYSTEM_PROMPT,
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "InterpretPaletteQueryOutput",
    effort: "low",
    thinking: false,
    maxTokens: 512,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: InterpretPaletteQueryInput): string {
  const lines: string[] = [];
  lines.push(`# Query`);
  lines.push(input.query);
  if (input.today) {
    lines.push("");
    lines.push(`# Today`);
    lines.push(input.today);
  }
  lines.push("");
  lines.push(`# Entries (${input.entries.length})`);
  for (const e of input.entries) {
    const parts = [`id=${e.id}`, `kind=${e.kind}`, `label="${e.label}"`];
    if (e.description) parts.push(`desc="${e.description}"`);
    if (e.project_slug) parts.push(`project_slug=${e.project_slug}`);
    if (e.partner_slug) parts.push(`partner_slug=${e.partner_slug}`);
    lines.push(`- ${parts.join(" · ")}`);
  }
  if (input.open_tasks && input.open_tasks.length > 0) {
    lines.push("");
    lines.push(`# Open tasks (project-scoped, for mark-task-done)`);
    for (const t of input.open_tasks) {
      lines.push(`- task_id=${t.task_id} · project=${t.project_slug} · text="${t.text}"`);
    }
  }
  if (input.open_follow_ups && input.open_follow_ups.length > 0) {
    lines.push("");
    lines.push(`# Open follow-ups (for resolve/snooze)`);
    for (const f of input.open_follow_ups) {
      lines.push(`- follow_up_id=${f.follow_up_id} · project="${f.project}" · task="${f.task}"`);
    }
  }
  lines.push("");
  lines.push("Pick one intent and fill its params. Return JSON only.");
  return lines.join("\n");
}

function validateOutput(raw: unknown): InterpretPaletteQueryOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const intent = requireString(obj, "intent") as InterpretPaletteIntentKind;
  const confirmation = requireString(obj, "confirmation");
  const confidenceRaw = obj["confidence"];
  if (typeof confidenceRaw !== "number") {
    throw new Error("confidence must be a number");
  }
  const out: InterpretPaletteQueryOutput = {
    intent,
    confirmation,
    confidence: clamp01(confidenceRaw),
  };
  if (typeof obj["entry_id"] === "string") out.entry_id = obj["entry_id"];
  if (typeof obj["task_text"] === "string") out.task_text = obj["task_text"];
  if (typeof obj["follow_up_by"] === "string") out.follow_up_by = obj["follow_up_by"];
  if (typeof obj["status"] === "string") out.status = obj["status"];
  if (typeof obj["ticket_id"] === "string") out.ticket_id = obj["ticket_id"];
  if (typeof obj["task_id"] === "string") out.task_id = obj["task_id"];
  if (typeof obj["follow_up_id"] === "string")
    out.follow_up_id = obj["follow_up_id"];
  if (typeof obj["snooze_days"] === "number")
    out.snooze_days = Math.max(1, Math.round(obj["snooze_days"]));
  return out;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string") throw new Error(`${key} must be a string`);
  return v;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
