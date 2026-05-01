// Public types for the ContextA8C client.

import type { ActivityEvent, Ping, SourceResult } from "../types";

/**
 * Per-project activity query. The mock transport reads the linked refs from
 * frontmatter to generate plausible events; the real transport will use the
 * same fields to scope its sub-MCP calls.
 */
export interface ProjectActivityQuery {
  project_slug: string;
  /** Project name as a fallback when generating actor-facing strings. */
  project_name: string;
  /** Frontmatter-style refs that drive activity sourcing. */
  refs: ProjectActivityRefs;
  /** Cap on the number of events returned. Defaults to 20. */
  limit?: number;
  /** ISO timestamp; only events at-or-after this point. */
  since?: string;
  /** Restrict to specific source kinds. */
  sources?: ActivitySourceFilter[];
}

export type ActivitySourceFilter =
  | "slack"
  | "github"
  | "linear"
  | "zendesk"
  | "p2"
  | "wpcom";

export interface ProjectActivityRefs {
  github_repo?: string;
  linear_project_slug?: string;
  linear_project_id?: string;
  /** Raw IDs or full URLs; first is the primary thread. */
  zendesk_tickets?: string[];
  p2_url?: string;
  primary_slack_channel?: string;
  team_slack_channel?: string;
  partner?: string;
}

export interface PingsQuery {
  /** Cap on the number of pings returned. Defaults to 25. */
  limit?: number;
  /** ISO timestamp; only pings at-or-after this point. */
  since?: string;
  /** Restrict to specific source kinds. */
  sources?: ("slack" | "p2" | "zendesk")[];
}

export interface ZendeskTicketSummary {
  id: string;
  subject: string | null;
  status: string | null;
  priority: string | null;
  updated_at: string | null;
  url: string;
}

export interface ContextA8CClient {
  listProjectActivity(
    query: ProjectActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>>;

  listPings(query: PingsQuery): Promise<SourceResult<Ping[]>>;

  /**
   * Per-ticket metadata fetch for the workbench's Zendesk threads
   * panel. Returns null when the ref can't be parsed; degraded
   * (subject=null) when the upstream call fails so the caller can
   * still surface "we have a ticket id but no live data" rows.
   */
  fetchZendeskTicketSummary(
    ticketRef: string,
  ): Promise<ZendeskTicketSummary | null>;

  /**
   * Search Zendesk tickets by subject / requester / tags. Used by the
   * "Attach Zendesk thread" modal — interactive, so we surface a hard
   * ok/error rather than a SourceResult (no caching: each query is
   * different and freshness matters more than resilience).
   */
  searchZendeskTickets(
    query: string,
    opts?: { limit?: number },
  ): Promise<ZendeskSearchResult>;

  /**
   * Recent comments on a single ticket. Used by the per-thread
   * "Recent activity" disclosure on the project workbench. Returns
   * an empty array on any failure so the UI can degrade silently —
   * a missing activity disclosure is far less disruptive than a
   * crashed panel.
   */
  fetchZendeskTicketActivity(
    ticketRef: string,
    opts?: { limit?: number; projectSlug?: string },
  ): Promise<ActivityEvent[]>;
}

export type ZendeskSearchResult =
  | { ok: true; tickets: ZendeskTicketSummary[] }
  | { ok: false; error: string };
