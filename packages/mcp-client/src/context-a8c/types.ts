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
   * Bulk version of the per-ticket fetch. Uses a single search query
   * (typically the partner's display name) to retrieve a batch of
   * tickets at once, then matches them against the supplied refs by
   * ticket_id. Refs that don't appear in the search results fall
   * back to a degraded summary so the panel can still render the row.
   *
   * The upstream MCP only exposes a `search` tool — there's no
   * single-ticket fetcher — so this is the only reliable way to
   * populate subject + status for several tickets at once.
   */
  fetchZendeskTicketSummaries(
    refs: string[],
    opts?: { searchHint?: string },
  ): Promise<ZendeskTicketSummary[]>;

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

  /**
   * Fetch a Linear project's metadata (name, description, state,
   * target_date, lead) by id or slug. Used by the project metadata
   * edit modal as a "Use Linear value" hint sidebar — the user can
   * pull individual fields into their frontmatter. Returns null when
   * the upstream lookup fails so the modal can degrade to a "couldn't
   * fetch from Linear" pill instead of crashing.
   */
  getLinearProjectMetadata(refs: {
    project_id?: string;
    project_slug?: string;
  }): Promise<LinearProjectMetadata | null>;

  /**
   * Search GitHub issues across a list of repos for mentions of the
   * given handle. Used by the /today page to surface GitHub pings.
   * Degrades gracefully when GITHUB_TOKEN is absent — returns [].
   */
  listGithubMentionPings(
    repos: string[],
    handle: string,
  ): Promise<Ping[]>;
}

export interface LinearProjectMetadata {
  /** Linear project id (uuid). */
  id: string;
  /** Display name. */
  name: string;
  /** URL slug — Linear-side equivalent of our linear_project_slug. */
  slug?: string;
  description?: string;
  /** Linear's project state: "backlog", "planned", "started", "paused", "completed", "canceled". */
  state?: string;
  /** ISO date when the project should be done. */
  target_date?: string;
  /** Display name of the project lead, when set. */
  lead?: string;
  /** Linear UI URL for the project, for "Open in Linear" links. */
  url?: string;
}

export type ZendeskSearchResult =
  | { ok: true; tickets: ZendeskTicketSummary[] }
  | { ok: false; error: string };
