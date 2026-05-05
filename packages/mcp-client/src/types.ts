// Core types for the MCP client.

/**
 * Every MCP-fronted call returns a `SourceResult`. This forces the UI to
 * handle the four real-world cases explicitly:
 *
 *   1. fresh data (just fetched)
 *   2. cached fresh data (within TTL, no fetch needed)
 *   3. stale data (past TTL, returning cache while a background refresh runs)
 *   4. error, optionally with last-known cached data to render in a degraded state
 *
 * Cases 3 + 4 are why we don't return plain `T | Error` — the UI needs to
 * show data with a "data from Xh ago" indicator, not throw away what it has.
 */
export type SourceResult<T> =
  | {
      ok: true;
      data: T;
      from: "fresh" | "cache" | "stale";
      /** ISO timestamp of when the cached data was fetched, when applicable. */
      fetched_at: string;
    }
  | {
      ok: false;
      error: McpError;
      /** Last-known cached data, when present. UI may render in a degraded mode. */
      cachedData?: T;
      /** ISO timestamp of the cached data, when present. */
      fetched_at?: string;
    };

export interface McpError {
  /** Stable code for routing (e.g. "auth", "rate-limit", "timeout", "unknown"). */
  code: string;
  message: string;
  /** Source identifier this error came from. */
  source: McpSourceId;
  /** Underlying error message, when available. */
  cause?: string;
  /** Was this attempt retried by the resilience layer? */
  retried: boolean;
  /** When the error happened, ISO. */
  at: string;
}

export type McpSourceId =
  | "context_a8c.slack"
  | "context_a8c.github"
  | "context_a8c.linear"
  | "context_a8c.zendesk"
  | "context_a8c.p2"
  | "context_a8c.wpcom"
  | "hive_mind"
  | "fathom";

/**
 * Per-source health snapshot. Surfaced in /settings → MCP Health and in the
 * app header's amber indicator when anything is degraded.
 */
export interface SourceHealth {
  source: McpSourceId;
  status: "ok" | "degraded" | "down" | "unknown";
  /** ISO timestamp of the last successful call. */
  last_success_at?: string;
  /** ISO timestamp of the last attempt (success or fail). */
  last_attempt_at?: string;
  /** Most recent error message, when present. */
  last_error?: string;
  /** Count of consecutive failures since last success. */
  consecutive_failures: number;
}

/**
 * A unified activity event surfaced in project workbench Live Activity feeds
 * and the /today derived dashboard. All sources normalize into this shape.
 */
export interface ActivityEvent {
  id: string;
  source: ActivitySource;
  kind: ActivityKind;
  /** ISO timestamp the event occurred. */
  timestamp: string;
  actor?: ActivityActor;
  title: string;
  excerpt?: string;
  url?: string;
  /** Inferred project this event belongs to, when matched. */
  project_match?: ProjectMatch;
  /** True when the event is from a mock transport — UI shows a "demo" badge. */
  is_mock?: boolean;
}

export type ActivitySource =
  | "slack"
  | "github"
  | "linear"
  | "zendesk"
  | "p2"
  | "wpcom";

export type ActivityKind =
  | "message" // Slack message in channel
  | "thread-reply" // Slack threaded reply
  | "commit"
  | "pr-opened"
  | "pr-merged"
  | "pr-comment"
  | "issue-opened"
  | "issue-closed"
  | "issue-comment"
  | "linear-issue-created"
  | "linear-issue-updated"
  | "linear-issue-completed"
  | "p2-post"
  | "p2-comment"
  | "zendesk-ticket"
  | "zendesk-comment";

export interface ActivityActor {
  name: string;
  handle?: string;
  /** Computed from internal_email_domains in config. */
  is_external: boolean;
  avatar_url?: string;
}

export interface ProjectMatch {
  project_slug: string;
  matched_by:
    | "github_repo"
    | "linear_project"
    | "slack_channel"
    | "zendesk_ticket"
    | "p2_url"
    | "partner";
}

/**
 * An inbound message awaiting a response — what the /today dashboard's
 * "Pings to Action" card shows. A subset of ActivityEvent with stricter
 * filters: only kinds that imply someone is waiting on us.
 */
export interface Ping {
  id: string;
  source: "slack" | "p2" | "zendesk" | "linear" | "github";
  timestamp: string;
  from: ActivityActor;
  excerpt: string;
  url?: string;
  /** Slack thread id or P2 comment thread id, when applicable. */
  thread_id?: string;
  /** When matched to a project, the workbench can pre-assemble Phase 6 context. */
  project_match?: ProjectMatch;
  /** True when the ping is from a mock transport. */
  is_mock?: boolean;
}

/**
 * Hive Mind partner profile — the canonical "what we know about this partner"
 * record. Mostly text fields drawn from the partner-knowledge.md body.
 */
export interface PartnerProfile {
  partner_slug: string;
  display_name: string;
  /** Free-form summary, rendered as markdown. */
  summary: string;
  /** Tags from frontmatter (e.g. ["nonprofit", "research"]). */
  tags: string[];
  /** Core team members on the partner's side (from frontmatter or the body). */
  team: PartnerTeamMember[];
  /** True when the partner profile carries an NDA flag. */
  nda: boolean;
  /** True when the data is from a mock transport. */
  is_mock?: boolean;
}

export interface PartnerTeamMember {
  name: string;
  role?: string;
  email?: string;
  notes?: string;
}

/** Reference to a call recording from the configured transcription provider. */
export interface CallRecordingRef {
  recording_id: string;
  recorded_at: string;
  duration_seconds: number;
  title?: string;
  source_url?: string;
  is_mock?: boolean;
}
