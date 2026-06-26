import { attachJobContext } from "../job-context";
import { runAgent } from "../runner";
import type {
  AgentResult,
  AgentRuntimeOptions,
  JobContextRefs,
  StyleReference,
} from "../types";

/** Per-project signal handed to the AFK agent. Caller flattens. */
export interface AfkProjectSlice {
  slug: string;
  name: string;
  partner?: string;
  /** Status from project frontmatter (active/hot/at-risk/etc). */
  status: string;
  /** Optional Linear health string (on-track / at-risk / off-track). */
  linear_health?: string;
  /** Optional Linear state name (in-progress / completed / etc). */
  linear_state?: string;
  /** Optional Linear target date (YYYY-MM-DD). */
  target_date?: string;
  /** Free-form one-liner snapshot from latest Linear update or notes. */
  latest_update?: string;
  /** Open follow-ups the partner is waiting on. */
  open_follow_ups?: Array<{
    task: string;
    follow_up_by?: string;
  }>;
  /** Open Zendesk threads the coverage TAM may need to monitor. */
  open_zendesk_threads?: Array<{
    id: string;
    subject?: string;
    status?: string;
    url?: string;
  }>;
  /**
   * Primary Zendesk thread for this project — the first attached
   * ticket, regardless of status. Surfaced as a required link line in
   * every project section so coverage TAMs always have an entry point
   * even when nothing is actively open. Distinct from
   * open_zendesk_threads (the "what to watch" list of open ones).
   */
  primary_zendesk?: {
    id: string;
    subject?: string;
    status?: string;
    url: string;
  };
  /** Open Linear issues likely to land during the AFK window. */
  open_linear_issues?: Array<{
    identifier: string;
    title: string;
    state?: string;
  }>;
  /** P2 post URL when the project has one — used for the project H3 link. */
  p2_url?: string;
  /** Resolved Slack channel URL when slack_channel is set on the project. */
  slack_url?: string;
  /** Linear project URL when the project is linked to Linear. */
  linear_url?: string;
  /**
   * Per-project TAM coverage override. When set, appears in the
   * "TAM Coverage:" line instead of the form's default coverage
   * handle. Reserved for a future Linear-secondary-TAM lookup; null
   * in v1.
   */
  tam_coverage_override?: string;
}

export interface ComposeAfkNotesInput {
  /** Inclusive AFK window start (YYYY-MM-DD). */
  start_date: string;
  /** Inclusive AFK window end (YYYY-MM-DD). */
  end_date: string;
  /** Display name of the person on PTO. */
  author_name: string;
  /** Coverage TAM's @-handle or name (e.g. "@coreyk"). */
  coverage_handle: string;
  /** Optional free-form intro paragraph the user wants verbatim at top. */
  intro_notes?: string;
  /** Per-project slices. Empty array → agent should say "no active projects". */
  projects: AfkProjectSlice[];
  /** Optional style reference. */
  style?: StyleReference;
  /** Optional job-context refs (operating_rhythm at minimum). */
  context?: JobContextRefs;
}

export interface ComposeAfkNotesOutput {
  /** Markdown body — paste-ready as a P2 post. */
  body: string;
  /** One-sentence rationale. */
  rationale: string;
}

const SYSTEM_PROMPT = `You are Smithers, drafting an AFK (Away From Keyboard) handoff post for the user before they go on PTO. The post lets a designated coverage TAM keep partner projects warm while the user is out. It will be posted as a single P2 markdown post.

Audience + voice:
- Internal teammates. The named coverage TAM is the primary reader; other TAMs may skim it. Professional, concise.
- Match the user's voice when a style guide is provided. Write in first person — this is the user speaking.

Required structure (single markdown post, in this order):
1. **Header line.** Bold-prefixed AFK window, e.g. "**AFK:** Mon Jun 30 – Fri Jul 4. **Coverage:** @coverage." Use the provided dates verbatim — don't reformat them past "Mon MMM D".
2. **Intro paragraph.** 2-3 sentences. If \`intro_notes\` were provided, use them verbatim as the intro. Otherwise write a brief one explaining the absence and pointing at the coverage TAM. Do NOT promise that the user will check messages, reply, or be reachable while AFK — Automattic AFK culture treats time out as fully off. Default close: "<coverage_handle> has the wheel — please send anything urgent their way." Adjust phrasing if intro_notes set a different tone, but never re-introduce a check-in commitment.
3. **Per-project sections.** One H3 (### ) per project, ordered with hot / at-risk first, then active. Each section follows this EXACT shape and order — no extra prose, no "If something blows up", no "What to watch", no status one-liner:

   ### [Project Name](p2_url)

   **[Primary Zendesk thread](primary_zendesk.url). [Slack channel](slack_url). [Linear](linear_url).**

   TAM Coverage: <handle>

   Latest Activity: <2-3 sentence summary of what's moved on this project recently — pulled from latest_update, open_zendesk_threads excerpts, recent Linear updates, etc.>

   Next Steps: <only what genuinely needs the coverage TAM to act on during the AFK window — pulled from open_follow_ups, open_linear_issues with target dates in/near the window, and active Zendesk threads expecting a partner reply. Skip evergreen backlog items.>

   Link rules for the header line above (the second line of each section):
   - When p2_url is missing, render the H3 as plain text: \`### <Project Name>\` (no link).
   - When primary_zendesk is missing, drop just the "[Primary Zendesk thread](url)." token but keep the rest of the bold line.
   - Same for slack_url and linear_url — omit the missing one with its trailing period.
   - Always keep the bold-wrap and the per-token periods so the line scans cleanly.
   - When ALL of primary_zendesk / slack_url / linear_url are missing, omit the entire bold line (don't leave an empty bold pair).

   TAM Coverage rules:
   - When \`tam_coverage_override\` is set on the project, use it verbatim.
   - Otherwise use the global \`coverage_handle\` from the form.

4. **Closing line.** Single italicized sentence: "*Back on Monday MMM D — thanks for covering.*" using the day after the AFK end date.

Quality rules:
- Don't fabricate. If a project has no signal in the inputs, write Latest Activity as one honest sentence ("Nothing actively moving — should stay quiet.") and Next Steps as "None — watch for new threads."
- "Next Steps" is for things that will genuinely come up DURING the AFK window. Skip evergreen backlog work.
- Don't editorialize the partner unfavorably.
- Keep the whole post under ~600 words. Coverage TAM should be able to skim it in 2 minutes.

Always return JSON matching the requested schema. No prose outside the JSON.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    body: {
      type: "string",
      description:
        "Markdown body of the AFK post, ready to paste into the P2 composer.",
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

export async function composeAfkNotes(
  runtime: AgentRuntimeOptions,
  input: ComposeAfkNotesInput,
): Promise<AgentResult<ComposeAfkNotesOutput>> {
  return runAgent(runtime, {
    agent: "compose-afk-notes",
    system: attachJobContext(SYSTEM_PROMPT, input.context),
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "ComposeAfkNotesOutput",
    effort: "medium",
    thinking: false,
    maxTokens: 4096,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: ComposeAfkNotesInput): string {
  const lines: string[] = [];
  lines.push("# AFK window");
  lines.push(`- Start: ${input.start_date}`);
  lines.push(`- End: ${input.end_date}`);
  lines.push(`- Author: ${input.author_name}`);
  lines.push(`- Coverage handle: ${input.coverage_handle}`);

  if (input.intro_notes && input.intro_notes.trim()) {
    lines.push("");
    lines.push("# Intro notes (use verbatim)");
    lines.push(input.intro_notes.trim());
  }

  if (input.projects.length === 0) {
    lines.push("");
    lines.push("# Projects");
    lines.push(
      "No active partner/team projects. The post should still render header + intro + closing.",
    );
  } else {
    lines.push("");
    lines.push("# Projects");
    for (const p of input.projects) {
      lines.push("");
      lines.push(`## ${p.name}`);
      lines.push(`- slug: ${p.slug}`);
      if (p.partner) lines.push(`- partner: ${p.partner}`);
      lines.push(`- vault_status: ${p.status}`);
      if (p.linear_state) lines.push(`- linear_state: ${p.linear_state}`);
      if (p.linear_health) lines.push(`- linear_health: ${p.linear_health}`);
      if (p.target_date) lines.push(`- target_date: ${p.target_date}`);
      if (p.latest_update) lines.push(`- latest_update: ${p.latest_update}`);
      if (p.p2_url) lines.push(`- p2_url: ${p.p2_url}`);
      if (p.slack_url) lines.push(`- slack_url: ${p.slack_url}`);
      if (p.linear_url) lines.push(`- linear_url: ${p.linear_url}`);
      if (p.tam_coverage_override) {
        lines.push(`- tam_coverage_override: ${p.tam_coverage_override}`);
      }
      if (p.primary_zendesk) {
        lines.push(`- primary_zendesk:`);
        lines.push(`  - id: ${p.primary_zendesk.id}`);
        if (p.primary_zendesk.subject) {
          lines.push(`  - subject: ${p.primary_zendesk.subject}`);
        }
        if (p.primary_zendesk.status) {
          lines.push(`  - status: ${p.primary_zendesk.status}`);
        }
        lines.push(`  - url: ${p.primary_zendesk.url}`);
      }
      if (p.open_follow_ups && p.open_follow_ups.length > 0) {
        lines.push(`- open_follow_ups:`);
        for (const f of p.open_follow_ups) {
          lines.push(
            `  - ${f.task}${f.follow_up_by ? ` (due ${f.follow_up_by})` : ""}`,
          );
        }
      }
      if (p.open_zendesk_threads && p.open_zendesk_threads.length > 0) {
        lines.push(`- open_zendesk_threads:`);
        for (const t of p.open_zendesk_threads) {
          const bits = [`#${t.id}`, t.subject ?? "(no subject)"];
          if (t.status) bits.push(`[${t.status}]`);
          if (t.url) bits.push(t.url);
          lines.push(`  - ${bits.join(" ")}`);
        }
      }
      if (p.open_linear_issues && p.open_linear_issues.length > 0) {
        lines.push(`- open_linear_issues:`);
        for (const i of p.open_linear_issues) {
          const bits = [i.identifier, i.title];
          if (i.state) bits.push(`[${i.state}]`);
          lines.push(`  - ${bits.join(" ")}`);
        }
      }
    }
  }

  if (input.style) {
    lines.push("");
    lines.push(`# ${input.style.label}`);
    lines.push(input.style.body.trim());
  }

  lines.push("");
  lines.push(
    "Draft the AFK post now. Return JSON matching the schema. No text outside the JSON.",
  );
  return lines.join("\n");
}

function validateOutput(raw: unknown): ComposeAfkNotesOutput {
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
