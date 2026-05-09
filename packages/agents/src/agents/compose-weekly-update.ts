import { runAgent } from "../runner";
import type {
  AgentResult,
  AgentRuntimeOptions,
  StyleReference,
} from "../types";

/**
 * Per-project facts handed to the weekly-update agent. Mirrors the
 * apps/web ProjectFacts shape but kept local here so packages/agents
 * doesn't depend on apps/web. The caller is expected to flatten the
 * MCP-side ActivityEvent + LinearProjectUpdate types into this thinner
 * shape — only the fields the prompt actually references.
 */
export interface WeeklyUpdateProjectFacts {
  slug: string;
  name: string;
  partner?: string;
  status: string;
  /** One short line per relevant event during the week. */
  event_lines: string[];
  /** Linear project updates posted during the week (date + body). */
  linear_updates: Array<{ date: string; body: string; health?: string }>;
  /** Calls that landed during the week (title + summary). */
  calls: Array<{ title: string; date: string; summary?: string }>;
  /** Drafts touched during the week (title + channel). */
  drafts: Array<{ title: string; channel?: string }>;
}

export interface WeeklyUpdateInput {
  /** ISO week id, e.g. "2026-W19". */
  iso_week: string;
  /** Monday of the week (YYYY-MM-DD). */
  week_start: string;
  /** Sunday of the week (YYYY-MM-DD). */
  week_end: string;
  /** Per-project facts assembled by the caller. */
  projects: WeeklyUpdateProjectFacts[];
  /**
   * Format instructions — free-form text that controls the prose
   * structure. The default (when empty) is the per-project list with
   * Last Week / This Week sections; the user can override in config.
   */
  format_instructions?: string;
  /** Optional voice/style guide. */
  style?: StyleReference;
  /**
   * Optional notes the user has attached to the run (e.g. "AFK Mon-Wed
   * next week"). Surface verbatim in the agent prompt; the model uses
   * them in the This Week section.
   */
  user_notes?: string;
}

export interface WeeklyUpdateOutput {
  /** Markdown body, ready to paste into a P2 comment. Should NOT include the header that page renders. */
  body: string;
  /** One-sentence rationale explaining the choices the agent made (what got included / cut). */
  rationale: string;
}

const DEFAULT_FORMAT = `Use this structure:

# Weekly Update — Week {N} ({date_range})

## Last Week
* **Project Name:** what happened. Tag teammates by @handle when relevant.
* (one bullet per project that had activity OR is open and needs to be on the team's radar)
* **Meetings/Other:** roll-up of recurring meetings and one-offs not tied to a single project.

## This Week
* **Project Name:** what's planned. Tag teammates by @handle when relevant.
* (one bullet per open project)
* **Meetings/Other:** upcoming meetings and one-offs.

Tone: brief, scannable, casual professional. One short sentence or fragment per bullet — not a paragraph. Use Slack-style @handle mentions when teammates collaborated.`;

const SYSTEM_PROMPT = `You are Smithers, drafting Katie's weekly update for the team P2. The team posts a single weekly thread each Monday and every TAM adds their update as a comment. This is internal — written for teammates, not partners.

Voice rules:
- Sound like a TAM giving teammates a status update. Brief, scannable, specific.
- Match the user's voice when a style guide is provided.
- One short sentence or fragment per bullet. Not paragraphs.
- Use Slack-style @handle mentions for collaborators where the source data names them.
- Don't fabricate. If a project had no activity, you can either omit it OR list it with a brief note ("steady-state, no movement"). Never invent decisions or events.

Quality rules:
- Lead with substance — what changed, what was decided, what the partner is waiting on.
- Skip filler like "had a great call" or "made progress on" — be specific.
- Keep "Meetings/Other" terse: comma-separated list of attended meetings + standing items.
- Do NOT include action items the user owns privately — those live in their personal queue.
- Do NOT include partner-confidential decisions teammates don't need to see.

Always return your output as JSON matching the requested schema. No text outside the JSON.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    body: {
      type: "string",
      description:
        "Markdown body of the weekly update, ready to paste as a P2 comment.",
    },
    rationale: {
      type: "string",
      description:
        "One-sentence explanation of which projects got included and which got cut.",
    },
  },
  required: ["body", "rationale"],
  additionalProperties: false,
};

export async function composeWeeklyUpdate(
  runtime: AgentRuntimeOptions,
  input: WeeklyUpdateInput,
): Promise<AgentResult<WeeklyUpdateOutput>> {
  return runAgent(runtime, {
    agent: "compose-weekly-update",
    system: SYSTEM_PROMPT,
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "WeeklyUpdateOutput",
    effort: "high",
    thinking: false,
    maxTokens: 4096,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: WeeklyUpdateInput): string {
  const { iso_week, week_start, week_end, projects, format_instructions, style, user_notes } = input;
  const lines: string[] = [];

  lines.push(`# Week`);
  lines.push(`- ID: ${iso_week}`);
  lines.push(`- Date range: ${week_start} → ${week_end}`);
  if (user_notes) {
    lines.push("");
    lines.push(`# User notes for this run`);
    lines.push(user_notes.trim());
  }

  lines.push("");
  lines.push(`# Format instructions`);
  lines.push(format_instructions?.trim() || DEFAULT_FORMAT);

  if (style) {
    lines.push("");
    lines.push(`# ${style.label}`);
    lines.push(style.body.trim());
  }

  lines.push("");
  lines.push(`# Per-project facts (${projects.length} project${projects.length === 1 ? "" : "s"} in scope)`);
  for (const p of projects) {
    lines.push("");
    lines.push(`## ${p.name}${p.partner ? ` — ${p.partner}` : ""}`);
    lines.push(`- slug: ${p.slug}`);
    lines.push(`- status: ${p.status}`);
    if (p.event_lines.length > 0) {
      lines.push(`- Activity (${p.event_lines.length} events):`);
      for (const line of p.event_lines.slice(0, 30)) {
        lines.push(`  - ${line}`);
      }
    } else {
      lines.push(`- Activity: none this week`);
    }
    if (p.linear_updates.length > 0) {
      lines.push(`- Linear project updates:`);
      for (const u of p.linear_updates) {
        lines.push(`  - ${u.date}${u.health ? ` [${u.health}]` : ""}: ${truncate(u.body, 240)}`);
      }
    }
    if (p.calls.length > 0) {
      lines.push(`- Calls:`);
      for (const c of p.calls) {
        lines.push(`  - ${c.date} — ${c.title}${c.summary ? `: ${truncate(c.summary, 240)}` : ""}`);
      }
    }
    if (p.drafts.length > 0) {
      lines.push(`- Drafts touched:`);
      for (const d of p.drafts) {
        lines.push(`  - ${d.title}${d.channel ? ` (${d.channel})` : ""}`);
      }
    }
  }

  lines.push("");
  lines.push(
    "Draft Katie's weekly update now using the format instructions above. Return JSON matching the schema. No text outside the JSON.",
  );
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1) + "…";
}

function validateOutput(raw: unknown): WeeklyUpdateOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.body !== "string") throw new Error('field "body" must be a string');
  if (typeof obj.rationale !== "string") {
    throw new Error('field "rationale" must be a string');
  }
  return {
    body: obj.body,
    rationale: obj.rationale,
  };
}
