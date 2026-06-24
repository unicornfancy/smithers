import "server-only";

import type { Ping } from "@smithers/mcp-client";

export interface MentionRow {
  ping: Ping;
  /** "linear" | "github" — used by the card to render a tiny source chip. */
  source: "linear" | "github";
}

/**
 * Filter the pre-merged /today pings list down to just @-mentions.
 * Linear notifications carry their raw type (`issueMention`,
 * `issueCommentMention`, etc) on the ping; GitHub mention pings have
 * `notification_type = "mention"` written by the mapper. Slack is
 * excluded by design — the user opted out of pulling workspace
 * mentions because partner project chatter would dominate the card.
 *
 * Returns newest-first. Caller decides how many to render (the card
 * caps at ~5 inline + a "see all" link to the full Pings to Action
 * surface for the rest).
 */
export function filterMentions(pings: Ping[]): MentionRow[] {
  const rows: MentionRow[] = [];
  for (const p of pings) {
    const source = classifyMention(p);
    if (!source) continue;
    rows.push({ ping: p, source });
  }
  rows.sort((a, b) => b.ping.timestamp.localeCompare(a.ping.timestamp));
  return rows;
}

function classifyMention(p: Ping): "linear" | "github" | null {
  if (p.source === "github" && p.notification_type === "mention") {
    return "github";
  }
  if (p.source === "linear") {
    const t = (p.notification_type ?? "").toLowerCase();
    // Linear emits multiple mention sub-types (issueMention,
    // issueCommentMention, documentMention, projectMention, ...).
    // Substring match catches the lot without enumerating each.
    if (t.includes("mention")) return "linear";
  }
  return null;
}
