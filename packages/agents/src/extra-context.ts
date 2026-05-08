/**
 * Shared helper for rendering "extra context" blocks in draft-agent
 * user prompts. Phase H: every draft agent (draft-zendesk-reply,
 * compose-followup-nudge, draft-p2-update, compose-call-recap, etc.)
 * accepts an optional `extra_context` array; this module renders it as
 * appended `# Additional context` markdown sections.
 *
 * Structural input — kept independent of @smithers/mcp-client's
 * ContextItem shape so this package doesn't need that dep. The two
 * shapes are deliberately the same field set.
 */

export interface DraftExtraContextItem {
  type:
    | "slack-thread"
    | "slack-message"
    | "github-issue-comment"
    | "call-transcript"
    | "zendesk-ticket"
    | "linear-issue"
    | "linear-project";
  /** Stable identifier (URL or vault path). Surfaced as a header marker. */
  ref: string;
  /** Short human-readable label for the agent's awareness. */
  label: string;
  /** The fetched body of the context item. */
  body: string;
}

/**
 * Shared system-prompt fragment that tells any draft agent how to use
 * the `# Additional context` block when present in the user prompt. Keep
 * the guidance consistent across affordances so behavior matches user
 * expectations (the user-side UX is the same picker for all of them).
 */
export const EXTRA_CONTEXT_SYSTEM_PROMPT = `Using the "# Additional context" section (when present):
- The user pre-attached extra references (Slack threads, GitHub issues, Linear issues/projects, other Zendesk tickets, call transcripts) under "# Additional context". The user explicitly chose these — they are load-bearing for this draft.
- Treat them as authoritative source material. They typically contain the specific technical detail, prior decision, or partner concern the draft must reflect.
- When the attached context conflicts with the primary input (the ticket/follow-up/transcript you're drafting from), the attached context is usually more recent or more authoritative — go with it and acknowledge the change.
- Reference attached content by its substance ("as we discussed in yesterday's call", "per the design feedback in DSG51-436"), never by its URL or filename.
- Don't summarize the attached items back to the recipient — fold the relevant facts into the draft naturally.
- Prefer using attached context over asking clarifying questions when it's relevant.`;

/**
 * Render the user-prompt section for any non-empty extra-context list.
 * Returns an empty string when the list is empty so callers can append
 * unconditionally.
 *
 * Format:
 *   # Additional context
 *
 *   ## <label> (<type>)
 *   <body>
 *
 *   ## <label> (<type>)
 *   <body>
 */
export function renderExtraContextBlock(
  items: DraftExtraContextItem[] | undefined,
): string {
  if (!items || items.length === 0) return "";
  const blocks = items
    .filter((it) => it && it.body.trim().length > 0)
    .map((it) => `## ${it.label} (${it.type})\n${it.body.trim()}`);
  if (blocks.length === 0) return "";
  return ["# Additional context", ...blocks].join("\n\n");
}
