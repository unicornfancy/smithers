import { attachJobContext } from "../job-context";
import { runAgent } from "../runner";
import type {
  AgentResult,
  AgentRuntimeOptions,
  JobContextRefs,
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
  /**
   * Zendesk comments authored by the user (i.e. outgoing replies to the
   * partner) during the week. Load-bearing signal for "did this project
   * move last week" — when the TAM replies, the project is alive. The
   * caller filters activity events to internal-actor zendesk-comment
   * events, ideally matched against identity.email.
   */
  my_zendesk_replies: Array<{
    date: string;
    ticket_id?: string;
    subject?: string;
    excerpt?: string;
  }>;
  /**
   * Open project tasks parsed from `## Open Items` checkboxes in the
   * project body. Drives the "This Week" section — what's queued.
   * Capped upstream so the prompt doesn't balloon for long backlog
   * projects.
   */
  open_tasks: Array<{
    text: string;
    section?: string;
    priority?: "high" | "medium" | "low";
    due_date?: string;
  }>;
}

export interface WeeklyUpdateInput {
  /**
   * ISO week id of the *posting* week (e.g. "2026-W24"). The update
   * labelled "Week N" debriefs Week N-1 and plans Week N's work.
   */
  iso_week: string;
  /** Monday of the posting week (YYYY-MM-DD). */
  week_start: string;
  /** Sunday of the posting week (YYYY-MM-DD). */
  week_end: string;
  /**
   * Monday of the *debrief* week (Week N-1) — the period being
   * recapped in "Last Week."
   */
  debrief_week_start: string;
  /** Sunday of the debrief week. */
  debrief_week_end: string;
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
  /**
   * Optional job-context refs. Expected slices: operating_rhythm (cadence
   * + format expectations) and team_charter (what's worth featuring in
   * the writeup). The agent uses these to bias toward charter-aligned
   * accomplishments over routine maintenance.
   */
  context?: JobContextRefs;
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

Time-frame convention (load-bearing):
- The header reads "Week N (posting_week_range)". N is the POSTING week — the week the update is being published in.
- The "## Last Week" section debriefs the *previous* week (Week N-1). All per-project facts you receive — activity events, Zendesk replies, calls, Linear updates, drafts — were pulled from this debrief window.
- The "## This Week" section is forward-looking and refers to Week N (the posting week). It's sourced from the "Open tasks" list, not from activity. The user's per-run "user_notes" can override or add to it.
- Don't confuse the two: a Zendesk reply from Week N-1 belongs in Last Week. An open task belongs in This Week.

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

Signal weighting for Last Week vs This Week:
- "Last Week" content is what actually moved. The strongest signal is "My Zendesk replies" (per-project) — those are outbound comments the user sent on the partner's tickets (nudges, replies, or internal notes). They count as project movement EVEN IF the partner hasn't replied yet — pushing the project forward is movement, not just receiving a reply. A "Re: Q3 launch — checking in on the staging URL" with no inbound after it is still a load-bearing data point. Treat a week with multiple outbound nudges as an active project; treat one with no outbound + no Linear updates + no calls as a quiet week.
- "This Week" content is forward-looking and should be grounded in the "Open tasks" list (per-project) — these are the user's queued items for the project. Use the tasks as raw material: pull the substantive items into the This Week bullet, in plain English. Include enough specificity that a teammate can scan what's queued — don't reduce to "continue work on X" when the list has concrete items. Reasonable upper bound is 3-4 tasks per project, summarized as a comma-separated clause or short sentence. Drop pure-housekeeping items only if the bullet is getting too long; otherwise keep them.

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
    system: attachJobContext(SYSTEM_PROMPT, input.context),
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
  const {
    iso_week,
    week_start,
    week_end,
    debrief_week_start,
    debrief_week_end,
    projects,
    format_instructions,
    style,
    user_notes,
  } = input;
  const lines: string[] = [];

  lines.push(`# Week`);
  lines.push(`- Posting week (this update covers it): ${iso_week} · ${week_start} → ${week_end}`);
  lines.push(
    `- Debrief window (Last Week section content): ${debrief_week_start} → ${debrief_week_end}`,
  );
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
    if (p.my_zendesk_replies.length > 0) {
      lines.push(
        `- My Zendesk replies this week (load-bearing signal for "did this move"):`,
      );
      for (const r of p.my_zendesk_replies) {
        const parts: string[] = [r.date];
        if (r.ticket_id) parts.push(`#${r.ticket_id}`);
        if (r.subject) parts.push(r.subject);
        const head = parts.join(" · ");
        lines.push(
          `  - ${head}${r.excerpt ? `: ${truncate(r.excerpt, 200)}` : ""}`,
        );
      }
    } else {
      lines.push(`- My Zendesk replies this week: none`);
    }
    if (p.open_tasks.length > 0) {
      lines.push(`- Open tasks (queue for This Week):`);
      for (const t of p.open_tasks) {
        const tag: string[] = [];
        if (t.priority) tag.push(`[${t.priority}]`);
        if (t.due_date) tag.push(`[due ${t.due_date}]`);
        if (t.section) tag.push(`(${t.section})`);
        lines.push(
          `  - ${t.text}${tag.length ? ` ${tag.join(" ")}` : ""}`,
        );
      }
    } else {
      lines.push(`- Open tasks: none`);
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
