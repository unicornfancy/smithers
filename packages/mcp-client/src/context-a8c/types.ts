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
  | "wpcom";

export interface ProjectActivityRefs {
  github_repo?: string;
  linear_project_slug?: string;
  linear_project_id?: string;
  /** Raw IDs or full URLs; first is the primary thread. */
  zendesk_tickets?: string[];
  slack_channel?: string;
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

export interface MatticspaceGroupMember {
  /** Full display name. */
  name: string;
  /** WordPress.com username — the durable handle. */
  wp_username: string;
  /** Job title from matticspace; may be formal-sounding. */
  job_title: string;
  /** Sub-team this member belongs to (matticspace `team_group` field). */
  team_group: string;
  /** True for team leads. */
  is_team_lead: boolean;
  /** Profile URL on matticspace. */
  matticspace_url: string;
}

export interface MatticspaceGroupRoster {
  group_slug: string;
  group_name: string;
  group_url: string;
  total_members: number;
  members: MatticspaceGroupMember[];
}

export interface ContextA8CClient {
  listProjectActivity(
    query: ProjectActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>>;

  listPings(query: PingsQuery): Promise<SourceResult<Ping[]>>;

  /**
   * Fetch a Matticspace group's full roster via the matticspace
   * provider's `list-group-members` tool. `include_subteams: true`
   * for Team51 — the top-level "team-51" group has only the lead;
   * actual day-to-day team members live in sub-teams (Confluence /
   * Estuary / Geyser / Torrent / Wave / etc.).
   */
  listMatticspaceGroupMembers(
    groupSlug: string,
    opts?: { includeSubteams?: boolean },
  ): Promise<SourceResult<MatticspaceGroupRoster>>;

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

  /**
   * Resolve a Slack URL (message or thread) into a flattened text block
   * for use as extra context in a draft agent. Returns null when the
   * URL doesn't parse or the upstream call fails. The returned `body`
   * is a plain-text rendering: speaker + message lines separated by
   * blank lines.
   */
  resolveSlackUrl(url: string): Promise<{
    type: "slack-thread" | "slack-message";
    label: string;
    body: string;
  } | null>;

  /**
   * Resolve a GitHub issue or pull-request URL into a flattened text
   * block. Includes the title + body + all comments. Returns null on
   * parse or fetch failure.
   */
  resolveGithubUrl(url: string): Promise<{
    type: "github-issue-comment";
    label: string;
    body: string;
  } | null>;

  /**
   * Check whether the user has replied on a Zendesk ticket since the
   * given timestamp. "Replied" = any internal (non-external) comment
   * exists with `created_at > sinceTs`. Used by /today's "Pings to
   * action" panel to grey out already-actioned tickets. Returns false
   * on any failure (degrades silently).
   */
  checkZendeskTicketActioned(
    ticketRef: string,
    sinceTs: string,
  ): Promise<boolean>;

  /**
   * Check whether `login` has commented on a GitHub issue / PR since
   * the given timestamp. Used by /today's "Pings to action" panel to
   * grey out issues the user has already replied to. Returns false on
   * parse / fetch failure.
   */
  checkGithubIssueActioned(
    url: string,
    sinceTs: string,
    login: string,
  ): Promise<boolean>;

  /**
   * Check whether `slackHandle` has posted in a Slack thread / channel
   * since the given timestamp. Matches against the `user`, `username`,
   * and `user_name` fields the slack/get tool returns. Returns false on
   * parse / fetch failure.
   */
  checkSlackActioned(
    url: string,
    sinceTs: string,
    slackHandle: string,
  ): Promise<boolean>;

  /**
   * Fetch posts from an A8C P2 via the wpcom `posts-text` tool. Targets
   * specific posts by `slugs` or `ids` (preferred) or paginates over a
   * date range. Optionally includes approved comments inline.
   *
   * Internal P2s (wpspecialprojectsp2, to51, etc.) are reachable because
   * ContextA8C authenticates as the running user. Returns `[]` on parse
   * or auth failure — callers should degrade rather than crash.
   */
  fetchP2Posts(query: P2PostFetchQuery): Promise<P2Post[]>;
}

export interface P2PostFetchQuery {
  /** P2 host (bare or with scheme). Examples: "wpspecialprojectsp2.wordpress.com". */
  site: string;
  /** Match by post slug (post_name). Up to 100. */
  slugs?: string[];
  /** Match by numeric post id. Up to 100. Takes precedence over slugs. */
  ids?: number[];
  /** When true, each post carries approved comments inline. */
  include_comments?: boolean;
  /** Cap on comments per post when include_comments is true. Default 100, max 500. */
  max_comments_per_post?: number;
}

export interface P2PostAuthor {
  username: string;
  display_name: string;
}

export interface P2PostComment {
  id: number;
  author: P2PostAuthor;
  /** ISO timestamp. */
  date: string;
  content_text: string;
}

export interface P2Post {
  id: number;
  link: string;
  /** ISO timestamp of publication. */
  date: string;
  /** ISO timestamp of last modification. */
  modified: string;
  author: P2PostAuthor;
  title: string;
  content_text: string;
  excerpt: string;
  comments: P2PostComment[];
  comments_total: number;
  comments_truncated: boolean;
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
  /** Health status: "onTrack" | "atRisk" | "offTrack" | etc. */
  health?: string;
  /** Completion percentage (0–100). */
  progress?: number;
}

export type ZendeskSearchResult =
  | { ok: true; tickets: ZendeskTicketSummary[] }
  | { ok: false; error: string };
