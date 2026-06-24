import "server-only";

import type { Project, ZendeskTicketRef } from "@smithers/vault";
import type { ActivityEvent } from "@smithers/mcp-client";

import { loadConfig } from "./config";
import { getMcpClient } from "./mcp";

export interface WaitingThreadRow {
  /** Vault project slug — workbench link target. */
  project_slug: string;
  /** Vault project display name — for the row label. */
  project_name: string;
  /** Zendesk ticket id (number-as-string). */
  ticket_id: string;
  /** Frontmatter-captured subject; falls back to ticket id. */
  subject: string;
  /** Direct Zendesk URL. */
  ticket_url: string;
  /** Author of the last partner comment. */
  partner_actor_name: string;
  /** ISO timestamp of the last partner comment. */
  partner_replied_at: string;
  /** Whole-day count from today to the partner reply (positive = days ago). */
  days_waiting: number;
}

/**
 * Cross-project rollup of Zendesk threads waiting on a reply from you.
 *
 * Filters applied:
 *   - Only partner / team projects (skips personal scratchpads)
 *   - Tickets persisted in the project frontmatter with `status: open`
 *     (frontmatter is captured at attach time; we don't re-poll Zendesk
 *     for status freshness on every /today load)
 *   - Comments where the last commenter was NOT you. Zendesk outbound
 *     all routes through concierge@wordpress.com, so we signature-detect
 *     using `identity.name` rather than the actor.email field.
 *
 * One MCP call per open ticket — fanned out in parallel, ~200ms each.
 * Returned sorted oldest-first (longest-waiting partners surface up top).
 */
export async function listWaitingOnYouThreads(args: {
  projects: Project[];
  /** Cap on rows returned — UI typically renders top 6 inline. */
  limit?: number;
}): Promise<WaitingThreadRow[]> {
  const cfg = await loadConfig();
  const selfName = (cfg.identity.name ?? "").trim();
  if (!selfName) return [];
  const nameMatches = makeAuthorNameMatcher(selfName);
  if (!nameMatches) return [];

  const mcp = await getMcpClient();

  // Flatten projects → {project, ticketRef} pairs, filtered to open
  // tickets only. Frontmatter is the source of truth for status.
  type Candidate = { project: Project; ticket: ZendeskTicketRef };
  const candidates: Candidate[] = [];
  for (const project of args.projects) {
    if (project.kind !== "partner" && project.kind !== "team") continue;
    const tickets = project.zendesk_tickets ?? [];
    for (const ticket of tickets) {
      const status = (ticket.status ?? "").toLowerCase();
      if (status !== "open") continue;
      candidates.push({ project, ticket });
    }
  }

  const fetched = await Promise.all(
    candidates.map(async ({ project, ticket }) => {
      const events = await mcp.contextA8C
        .fetchZendeskTicketActivity(ticket.id, {
          projectSlug: project.slug,
          limit: 12,
        })
        .catch(() => [] as ActivityEvent[]);
      const lastPartner = findLastPartnerComment(events, nameMatches);
      if (!lastPartner) return null;
      return { project, ticket, lastPartner };
    }),
  );

  const todayUtcMs = startOfTodayUtcMs();
  const rows: WaitingThreadRow[] = [];
  for (const entry of fetched) {
    if (!entry) continue;
    const { project, ticket, lastPartner } = entry;
    const repliedMs = Date.parse(lastPartner.timestamp);
    const daysWaiting = Number.isNaN(repliedMs)
      ? 0
      : Math.max(0, Math.round((todayUtcMs - repliedMs) / (24 * 60 * 60 * 1000)));
    rows.push({
      project_slug: project.slug,
      project_name: project.name,
      ticket_id: ticket.id,
      subject: ticket.subject ?? `#${ticket.id}`,
      ticket_url: `https://automattic.zendesk.com/agent/tickets/${ticket.id}`,
      partner_actor_name: lastPartner.actor?.name ?? "partner",
      partner_replied_at: lastPartner.timestamp,
      days_waiting: daysWaiting,
    });
  }

  rows.sort((a, b) => b.days_waiting - a.days_waiting);
  return args.limit ? rows.slice(0, args.limit) : rows;
}

/**
 * Walk ticket activity newest-first and return the most recent comment
 * whose body does NOT signature-match the user. That's "the last
 * message that came from the partner side." Returns null when:
 *   - the most recent comment IS from the user (ball is in partner's court)
 *   - no zendesk-comment events exist
 */
function findLastPartnerComment(
  events: ActivityEvent[],
  nameMatches: (body: string) => boolean,
): ActivityEvent | null {
  // Activity comes back newest-first per the MCP contract.
  for (const event of events) {
    if (event.source !== "zendesk" || event.kind !== "zendesk-comment") continue;
    if (nameMatches(event.excerpt ?? "")) {
      // Most recent comment is YOUR reply → ball is in partner's
      // court, don't surface as "waiting on you."
      return null;
    }
    return event;
  }
  return null;
}

/**
 * Same shape as the matcher in weekly-facts.ts — duplicated here to
 * keep these helpers independent (rather than reaching across files
 * just for a regex). Multi-word names = anywhere-in-body; single-word
 * = last 30% only (signature zone, avoids "Hi Katie" false positives).
 */
function makeAuthorNameMatcher(rawName: string): ((body: string) => boolean) | null {
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    return (body) => re.test(body);
  }
  const re = new RegExp(`\\b${escaped}\\b`, "i");
  return (body) => {
    if (!body) return false;
    const tail = body.slice(Math.floor(body.length * 0.7));
    return re.test(tail);
  };
}

function startOfTodayUtcMs(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
