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
}
