/**
 * Real ContextA8C transport — talks to the user-installed
 * `@automattic/mcp-context-a8c` MCP server via stdio.
 *
 * Coverage today:
 * - listPings → Linear inbox (assignments, comments, mentions). Linear is
 *   the highest-signal "someone needs you" feed in this MCP and maps
 *   cleanly to the Ping shape. Slack DMs / mentions land in a follow-up.
 * - listProjectActivity → fans out across linear/issues, github/commits,
 *   github/pull-requests, and slack/messages based on which refs the
 *   project's frontmatter declares. Each source is independently
 *   isolated + cached via runIsolated so a flaky one doesn't take the
 *   whole feed down.
 */

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { runIsolated } from "../isolation";
import { StdioMcpClient } from "../stdio-mcp";
import type { ActivityEvent, Ping, SourceResult } from "../types";
import type {
  ActivitySourceFilter,
  ContextA8CClient,
  PingsQuery,
  ProjectActivityQuery,
} from "./types";
import { extractTicketId, zendeskTicketUrl } from "./zendesk-refs";

export interface ZendeskTicketSummary {
  /** Numeric ticket id. */
  id: string;
  subject: string | null;
  /** Zendesk status, when present (e.g. "open", "pending", "solved"). */
  status: string | null;
  /** Priority string, when present. */
  priority: string | null;
  /** ISO timestamp of last update. */
  updated_at: string | null;
  /** Canonical URL into the Automattic Zendesk admin. */
  url: string;
}

interface LinearInboxNotification {
  id?: string;
  type?: string;
  /** Free-form summary string the upstream provides for the inbox row. */
  message?: string;
  /** Some payload variants; defensive — context-a8c may evolve the shape. */
  title?: string;
  excerpt?: string;
  body?: string;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
  issue?: {
    identifier?: string;
    title?: string;
    url?: string;
    project?: { name?: string; slug?: string; id?: string };
  };
  actor?: {
    name?: string;
    displayName?: string;
    email?: string;
  };
}

interface LinearInboxResult {
  count?: number;
  notifications?: LinearInboxNotification[];
}

const PING_TTL = { freshMs: 5 * 60 * 1000 } as const;
const ACTIVITY_TTL = { freshMs: 5 * 60 * 1000 } as const;

// --- response shapes from each provider's tools ---
//
// Defined narrowly: only the fields we actually map. We don't try to
// model the full upstream types — the MCP responses are already JSON
// strings inside content blocks, so misshapen fields just become
// undefined and the mapper degrades.

interface LinearIssue {
  identifier?: string;
  title?: string;
  url?: string;
  status?: string;
  status_type?: string;
  priority_label?: string;
  project?: string;
  team?: string;
  updated_at?: string;
  due_date?: string | null;
  assignee?: { name?: string; display_name?: string; email?: string } | null;
}
interface LinearIssuesResult {
  count?: number;
  issues?: LinearIssue[];
}

interface GithubCommit {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string };
  };
  author?: { login?: string; profile_url?: string; avatar_url?: string };
}
interface GithubCommitsResult {
  result?: GithubCommit[];
}

interface GithubPull {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  merged_at?: string | null;
  closed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  user?: { login?: string; avatar_url?: string };
}
interface GithubPullsResult {
  result?: GithubPull[];
}

interface SlackMessage {
  ts?: string;
  date?: string;
  user?: string;
  username?: string;
  text?: string;
  permalink?: string;
  subtype?: string;
}
interface SlackMessagesResult {
  channel?: string;
  messages?: SlackMessage[];
}

interface SlackChannel {
  id?: string;
  name?: string;
  is_private?: boolean;
}
interface SlackChannelsResult {
  channels?: SlackChannel[];
}

interface ZendeskAuthor {
  id?: number | string;
  name?: string;
  email?: string;
  is_external?: boolean;
}
interface ZendeskComment {
  id?: number | string;
  body?: string;
  plain_body?: string;
  html_body?: string;
  public?: boolean;
  created_at?: string;
  author?: ZendeskAuthor;
  via?: { channel?: string };
}
interface ZendeskCommentsResult {
  comments?: ZendeskComment[];
  /** Some response shapes wrap the array in `result`. */
  result?: ZendeskComment[];
}
interface ZendeskTicket {
  /** Single-ticket fetch shape uses `id`. */
  id?: number | string;
  /** Search-result shape uses `ticket_id`. */
  ticket_id?: number | string;
  subject?: string;
  status?: string;
  priority?: string;
  updated_at?: string;
}
interface ZendeskTicketResult {
  ticket?: ZendeskTicket;
  result?: ZendeskTicket;
}
interface ZendeskSearchResultRaw {
  /** Context-a8c's actual shape: `{ query, count, next_page, tickets }`. */
  tickets?: ZendeskTicket[];
  /** Standard Zendesk search wraps under `results`. */
  results?: ZendeskTicket[];
  /** Some wrappers use `result`. */
  result?: ZendeskTicket[];
}

export class RealContextA8CTransport implements ContextA8CClient {
  private readonly mcp: StdioMcpClient;

  constructor(
    private readonly opts: ResolvedMcpClientOptions,
    private readonly cache: SwrCache,
    private readonly health: HealthRegistry,
  ) {
    this.mcp = new StdioMcpClient({
      label: "context-a8c",
      command: "npx",
      args: ["-y", "@automattic/mcp-context-a8c"],
    });
  }

  async listPings(query: PingsQuery): Promise<SourceResult<Ping[]>> {
    const cacheKey = `real:context_a8c:pings:linear:${query.limit ?? 25}`;
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "context_a8c.linear",
        cacheKey,
        ttl: PING_TTL,
        fetcher: async () => {
          const limit = Math.min(query.limit ?? 25, 100);
          const result = await this.mcp.callJsonTool<LinearInboxResult>(
            "context-a8c-execute-tool",
            {
              provider: "linear",
              tool: "inbox",
              params: { limit },
            },
          );
          return mapLinearInboxToPings(
            asArray(result?.notifications),
            this.opts.internalEmailDomains,
          );
        },
      },
    );
  }

  async listProjectActivity(
    query: ProjectActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>> {
    const limit = query.limit ?? 20;
    const allow = (s: ActivitySourceFilter) =>
      !query.sources || query.sources.length === 0 || query.sources.includes(s);

    const tasks: Array<Promise<SourceResult<ActivityEvent[]>>> = [];
    if (allow("linear") && hasLinearRef(query.refs)) {
      tasks.push(this.fetchLinearIssues(query));
    }
    if (allow("github") && query.refs.github_repo) {
      tasks.push(this.fetchGithubCommits(query));
      tasks.push(this.fetchGithubPullRequests(query));
    }
    if (allow("slack") && query.refs.primary_slack_channel) {
      tasks.push(this.fetchSlackMessages(query));
    }
    if (allow("zendesk") && (query.refs.zendesk_tickets ?? []).length > 0) {
      // One task per ticket so each thread caches independently and a
      // 404 on one ticket doesn't poison the others.
      for (const ref of query.refs.zendesk_tickets!) {
        tasks.push(this.fetchZendeskTicketComments(query, ref));
      }
    }

    if (tasks.length === 0) {
      return {
        ok: true,
        data: [],
        from: "fresh",
        fetched_at: new Date().toISOString(),
      };
    }

    // Each per-source result already went through runIsolated, so a
    // failure on one doesn't take the others down. Merge whatever
    // succeeded; if all failed, surface a degraded result.
    const results = await Promise.all(tasks);
    const events: ActivityEvent[] = [];
    let anyOk = false;
    let firstError: SourceResult<ActivityEvent[]> | null = null;
    for (const r of results) {
      if (r.ok) {
        anyOk = true;
        events.push(...r.data);
      } else if (!firstError) {
        firstError = r;
      }
    }

    if (!anyOk && firstError && !firstError.ok) {
      return firstError;
    }

    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return {
      ok: true,
      data: events.slice(0, limit),
      from: "fresh",
      fetched_at: new Date().toISOString(),
    };
  }

  // --- per-source fetchers (each isolated + cached independently) ---

  private async fetchLinearIssues(
    query: ProjectActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>> {
    const projectKey =
      query.refs.linear_project_id ??
      query.refs.linear_project_slug ??
      query.project_name;
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "context_a8c.linear",
        cacheKey: `real:context_a8c:project_activity:linear:${query.project_slug}`,
        ttl: ACTIVITY_TTL,
        fetcher: async () => {
          const result = await this.mcp.callJsonTool<LinearIssuesResult>(
            "context-a8c-execute-tool",
            {
              provider: "linear",
              tool: "issues",
              params: {
                project: projectKey,
                state_name_not_in: ["Done", "Canceled", "Duplicate"],
                limit: 20,
              },
            },
          );
          return mapLinearIssuesToActivity(
            asArray(result?.issues),
            query.project_slug,
            this.opts.internalEmailDomains,
          );
        },
      },
    );
  }

  private async fetchGithubCommits(
    query: ProjectActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>> {
    const repo = query.refs.github_repo!;
    const [owner, name] = repo.split("/");
    if (!owner || !name) {
      return failedResult(
        "context_a8c.github",
        "invalid",
        `Bad github_repo "${repo}" — expected owner/name`,
      );
    }
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "context_a8c.github",
        cacheKey: `real:context_a8c:project_activity:github_commits:${repo}`,
        ttl: ACTIVITY_TTL,
        fetcher: async () => {
          const result = await this.mcp.callJsonTool<GithubCommitsResult>(
            "context-a8c-execute-tool",
            {
              provider: "github",
              tool: "commits",
              params: { owner, repo: name, perPage: 10 },
            },
          );
          return mapGithubCommitsToActivity(
            asArray(result?.result),
            repo,
            query.project_slug,
            this.opts.internalEmailDomains,
          );
        },
      },
    );
  }

  private async fetchGithubPullRequests(
    query: ProjectActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>> {
    const repo = query.refs.github_repo!;
    const [owner, name] = repo.split("/");
    if (!owner || !name) {
      return failedResult(
        "context_a8c.github",
        "invalid",
        `Bad github_repo "${repo}" — expected owner/name`,
      );
    }
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "context_a8c.github",
        cacheKey: `real:context_a8c:project_activity:github_prs:${repo}`,
        ttl: ACTIVITY_TTL,
        fetcher: async () => {
          const result = await this.mcp.callJsonTool<GithubPullsResult>(
            "context-a8c-execute-tool",
            {
              provider: "github",
              tool: "pull-requests",
              params: {
                owner,
                repo: name,
                state: "all",
                sort: "updated",
                direction: "desc",
                perPage: 5,
              },
            },
          );
          return mapGithubPullsToActivity(
            asArray(result?.result),
            repo,
            query.project_slug,
            this.opts.internalEmailDomains,
          );
        },
      },
    );
  }

  private async fetchSlackMessages(
    query: ProjectActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>> {
    const channelName = query.refs.primary_slack_channel!;
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "context_a8c.slack",
        cacheKey: `real:context_a8c:project_activity:slack:${channelName}`,
        ttl: ACTIVITY_TTL,
        fetcher: async () => {
          // Slack `messages` needs a channel ID, not a name. Resolve
          // through `channels` (the SwrCache de-dupes the lookup so we
          // don't refetch the channel list per project).
          const channelId = await this.resolveSlackChannelId(channelName);
          if (!channelId) return [];

          const result = await this.mcp.callJsonTool<SlackMessagesResult>(
            "context-a8c-execute-tool",
            {
              provider: "slack",
              tool: "messages",
              params: { channel: channelId, limit: 15 },
            },
          );
          return mapSlackMessagesToActivity(
            asArray(result?.messages),
            channelName,
            channelId,
            query.project_slug,
            this.opts.internalEmailDomains,
          );
        },
      },
    );
  }

  private async fetchZendeskTicketComments(
    query: ProjectActivityQuery,
    ticketRef: string,
  ): Promise<SourceResult<ActivityEvent[]>> {
    const ticketId = extractTicketId(ticketRef);
    if (!ticketId) {
      return failedResult(
        "context_a8c.zendesk",
        "invalid",
        `Could not parse ticket id from "${ticketRef}"`,
      );
    }
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "context_a8c.zendesk",
        cacheKey: `real:context_a8c:project_activity:zendesk_comments:${ticketId}`,
        ttl: ACTIVITY_TTL,
        fetcher: async () => {
          const result = await this.mcp.callJsonTool<ZendeskCommentsResult>(
            "context-a8c-execute-tool",
            {
              provider: "zendesk",
              tool: "comments",
              params: { ticket_id: Number(ticketId), per_page: 10 },
            },
          );
          return mapZendeskCommentsToActivity(
            asArray<ZendeskComment>(result?.comments ?? result?.result),
            ticketId,
            query.project_slug,
            this.opts.internalEmailDomains,
          );
        },
      },
    );
  }

  /**
   * One-shot ticket-metadata fetch (subject + status + requester) for
   * the workbench's ZendeskThreadsPanel. No isolation wrapper because
   * this is called outside the activity fan-out — caller decides how
   * to handle failures (typically: degrade the row in the panel).
   */
  async fetchZendeskTicketSummary(
    ticketRef: string,
  ): Promise<ZendeskTicketSummary | null> {
    const ticketId = extractTicketId(ticketRef);
    if (!ticketId) return null;
    // The upstream MCP doesn't expose a `ticket` (singular) fetch tool —
    // it returned "Tool not found: ticket" — but `search` works and
    // accepts Zendesk's `id:<n>` filter, which gives us the same metadata.
    // We trade one indirection for a reliable path.
    try {
      const result = await this.mcp.callJsonTool<ZendeskSearchResultRaw>(
        "context-a8c-execute-tool",
        {
          provider: "zendesk",
          tool: "search",
          params: { query: `type:ticket id:${ticketId}`, per_page: 1 },
        },
      );
      const rawTickets = asArray<ZendeskTicket>(
        result?.tickets ?? result?.results ?? result?.result,
      );
      const t = rawTickets[0];
      if (!t) {
        // Search returned 0 — usually means access denied or deleted.
        // Surface a degraded row so the user sees we have the id but
        // couldn't load metadata.
        return {
          id: ticketId,
          subject: null,
          status: null,
          priority: null,
          updated_at: null,
          url: zendeskTicketUrl(ticketId),
        };
      }
      return {
        id: ticketId,
        subject: typeof t.subject === "string" ? t.subject : null,
        status: typeof t.status === "string" ? t.status : null,
        priority: typeof t.priority === "string" ? t.priority : null,
        updated_at: typeof t.updated_at === "string" ? t.updated_at : null,
        url: zendeskTicketUrl(ticketId),
      };
    } catch {
      return {
        id: ticketId,
        subject: null,
        status: null,
        priority: null,
        updated_at: null,
        url: zendeskTicketUrl(ticketId),
      };
    }
  }

  /**
   * Search Zendesk tickets by free-text query. Interactive endpoint —
   * called from the "Attach Zendesk thread" modal as the user types,
   * so we skip the runIsolated cache (each keystroke is a new query)
   * and surface a clean ok/error shape instead of a SourceResult.
   *
   * Zendesk's search syntax accepts free text plus filters like
   * `type:ticket subject:foo organization:bar` — we pass the query
   * through verbatim and let the user lean on syntax if they want.
   */
  async searchZendeskTickets(
    query: string,
    opts: { limit?: number } = {},
  ): Promise<
    | { ok: true; tickets: ZendeskTicketSummary[] }
    | { ok: false; error: string }
  > {
    const trimmed = query.trim();
    if (!trimmed) return { ok: true, tickets: [] };
    // Default to type:ticket so the search doesn't return user/org
    // records the user can't attach. Only prepend if the caller
    // hasn't already specified a type filter.
    // Pure-numeric query is a ticket-id lookup, not a free-text search —
    // Zendesk's search index doesn't include ticket ids, so route those
    // straight to the single-ticket fetch tool. Returns at most one row.
    if (/^\d+$/.test(trimmed)) {
      const summary = await this.fetchZendeskTicketSummary(trimmed);
      return { ok: true, tickets: summary ? [summary] : [] };
    }
    const fullQuery = /\btype:/i.test(trimmed)
      ? trimmed
      : `type:ticket ${trimmed}`;
    try {
      const result = await this.mcp.callJsonTool<ZendeskSearchResultRaw>(
        "context-a8c-execute-tool",
        {
          provider: "zendesk",
          tool: "search",
          params: {
            query: fullQuery,
            per_page: Math.max(1, Math.min(50, opts.limit ?? 20)),
          },
        },
      );
      const rawTickets = asArray<ZendeskTicket>(
        result?.tickets ?? result?.results ?? result?.result,
      );
      const tickets: ZendeskTicketSummary[] = rawTickets
        .map((t) => {
          // Search-result entries use `ticket_id`; single-fetch uses `id`.
          // Accept either so this mapper works for both shapes.
          const rawId = t.ticket_id ?? t.id;
          const id =
            typeof rawId === "number"
              ? String(rawId)
              : typeof rawId === "string"
                ? rawId
                : null;
          if (!id || !/^\d+$/.test(id)) return null;
          return {
            id,
            subject: typeof t.subject === "string" ? t.subject : null,
            status: typeof t.status === "string" ? t.status : null,
            priority: typeof t.priority === "string" ? t.priority : null,
            updated_at:
              typeof t.updated_at === "string" ? t.updated_at : null,
            url: zendeskTicketUrl(id),
          };
        })
        .filter((t): t is ZendeskTicketSummary => t !== null);
      return { ok: true, tickets };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error ? err.message : "Zendesk search failed",
      };
    }
  }

  /**
   * Resolve a Slack channel name to its ID. Cached for an hour because
   * the channel list rarely changes and pulling the whole workspace
   * (1000+ channels paginated) is expensive.
   */
  private async resolveSlackChannelId(name: string): Promise<string | null> {
    const cached = this.slackChannelMap;
    if (cached && Date.now() < this.slackChannelMapExpiresAt) {
      return cached.get(name) ?? null;
    }
    try {
      const result = await this.mcp.callJsonTool<SlackChannelsResult>(
        "context-a8c-execute-tool",
        {
          provider: "slack",
          tool: "channels",
          params: { limit: 1000 },
        },
      );
      const map = new Map<string, string>();
      for (const c of asArray<SlackChannel>(result?.channels)) {
        if (c.name && c.id) {
          map.set(c.name, c.id);
          // Frontmatter channels often carry a leading "#"; index both
          // forms so resolveSlackChannelId(name) works either way.
          map.set(`#${c.name}`, c.id);
        }
      }
      this.slackChannelMap = map;
      this.slackChannelMapExpiresAt = Date.now() + 60 * 60 * 1000;
      return map.get(name) ?? null;
    } catch {
      return null;
    }
  }

  private slackChannelMap: Map<string, string> | null = null;
  private slackChannelMapExpiresAt = 0;
}

function hasLinearRef(refs: ProjectActivityQuery["refs"]): boolean {
  return Boolean(refs.linear_project_id || refs.linear_project_slug);
}

/**
 * Build a synthetic SourceResult for the rare case where we can detect a
 * malformed input (e.g. a github_repo that doesn't split into owner/name)
 * before ever talking to the MCP. Most failures bubble up through
 * runIsolated which wraps the actual fetcher exceptions.
 */
function failedResult(
  source: ContextA8CSourceId,
  code: string,
  message: string,
): SourceResult<ActivityEvent[]> {
  return {
    ok: false,
    error: {
      code,
      message,
      source,
      retried: false,
      at: new Date().toISOString(),
    },
    cachedData: undefined,
  };
}

type ContextA8CSourceId =
  | "context_a8c.linear"
  | "context_a8c.github"
  | "context_a8c.slack"
  | "context_a8c.zendesk"
  | "context_a8c.p2"
  | "context_a8c.wpcom";

/**
 * Translate a Linear inbox notification into a Ping. Inbox items don't
 * always carry every field, so we degrade gracefully — blank actor,
 * generic excerpt — rather than dropping the row.
 */
export function mapLinearInboxToPings(
  notifications: LinearInboxNotification[],
  internalDomains: readonly string[],
): Ping[] {
  const seen = new Set<string>();
  const out: Ping[] = [];
  for (let i = 0; i < notifications.length; i++) {
    const ping = mapOne(notifications[i]!, i, internalDomains);
    if (!ping) continue;
    // Belt-and-suspenders: even with the more-unique fallback id we
    // build below, two notifications occasionally arrive with truly
    // identical metadata (assignment + comment on the same issue at
    // the same timestamp). Drop later duplicates so React's key
    // invariant holds.
    if (seen.has(ping.id)) continue;
    seen.add(ping.id);
    out.push(ping);
  }
  return out;
}

function mapOne(
  n: LinearInboxNotification,
  index: number,
  internalDomains: readonly string[],
): Ping | null {
  // Linear notification IDs are sometimes absent on inbox rows. Build
  // a fallback that combines type + issue identifier + timestamp so
  // two different notifications about the same issue (e.g. assignment
  // + new comment) get distinct keys. Index is a final tiebreaker.
  const id = n.id ?? buildLinearInboxFallbackId(n, index);
  const timestamp = n.createdAt ?? n.updatedAt ?? new Date().toISOString();
  const actor = n.actor ?? {};
  const actorName =
    actor.displayName ?? actor.name ?? "Linear notification";
  const isExternal = isExternalEmail(actor.email, internalDomains);

  // Linear notifications wrap an issue most of the time; fall back to
  // the notification's own message field when not.
  const issueTitle = n.issue?.title ?? "";
  const baseExcerpt =
    n.excerpt ?? n.message ?? n.body ?? n.title ?? issueTitle;
  const excerpt = formatExcerpt(n.type, issueTitle, baseExcerpt);

  return {
    id,
    source: "linear",
    timestamp,
    from: {
      name: actorName,
      handle: actor.email,
      is_external: isExternal,
    },
    excerpt,
    url: n.url ?? n.issue?.url,
    project_match: n.issue?.project?.slug
      ? {
          project_slug: n.issue.project.slug,
          matched_by: "linear_project",
        }
      : undefined,
    is_mock: false,
  };
}

/**
 * Compose a stable-but-unique id for a Linear inbox notification when
 * the upstream didn't give us one. Type + issue + timestamp covers
 * the common collision (multi-event same-issue), index is the final
 * tiebreaker for the rare case where everything else matches.
 */
function buildLinearInboxFallbackId(
  n: LinearInboxNotification,
  index: number,
): string {
  const parts: string[] = ["linear-inbox"];
  if (n.type) parts.push(n.type);
  if (n.issue?.identifier) parts.push(n.issue.identifier);
  if (n.createdAt) parts.push(n.createdAt);
  else if (n.updatedAt) parts.push(n.updatedAt);
  parts.push(String(index));
  return parts.join(":");
}

function formatExcerpt(
  type: string | undefined,
  issueTitle: string,
  fallback: string,
): string {
  if (!type) return fallback || "Linear notification";
  const prefix = humanizeNotificationType(type);
  if (issueTitle) return `${prefix}: ${issueTitle}`;
  return prefix;
}

function humanizeNotificationType(t: string): string {
  switch (t) {
    case "issueAssignedToYou":
    case "issueAssigned":
      return "Assigned to you";
    case "issueNewComment":
    case "issueCommentMention":
      return "New comment";
    case "issueMention":
      return "You were mentioned";
    case "issueStatusChanged":
      return "Status changed";
    case "issueDue":
      return "Due soon";
    case "projectUpdateMention":
      return "Project update mentions you";
    default:
      return t.replace(/([A-Z])/g, " $1").trim();
  }
}

function isExternalEmail(
  email: string | undefined,
  internalDomains: readonly string[],
): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  // Linear notifications come from teammates ~always, so default
  // unknown-domain to internal=false (skipping the partner-tint).
  return !internalDomains.some((d) => domain === d.toLowerCase());
}

// --- per-source mappers (exported for unit-testability) ---

export function mapLinearIssuesToActivity(
  issues: LinearIssue[],
  projectSlug: string,
  internalDomains: readonly string[],
): ActivityEvent[] {
  return issues
    .map((i) => mapLinearIssue(i, projectSlug, internalDomains))
    .filter((e): e is ActivityEvent => e !== null);
}

function mapLinearIssue(
  issue: LinearIssue,
  projectSlug: string,
  internalDomains: readonly string[],
): ActivityEvent | null {
  if (!issue.identifier || !issue.updated_at) return null;
  const kind: ActivityEvent["kind"] =
    issue.status_type === "completed"
      ? "linear-issue-completed"
      : issue.status_type === "started" || issue.status_type === "unstarted"
        ? "linear-issue-updated"
        : "linear-issue-created";

  const assignee = issue.assignee;
  return {
    id: `linear:${issue.identifier}`,
    source: "linear",
    kind,
    timestamp: issue.updated_at,
    actor: assignee
      ? {
          name: assignee.display_name ?? assignee.name ?? "Linear",
          handle: assignee.email,
          is_external: isExternalEmail(assignee.email, internalDomains),
        }
      : undefined,
    title: issue.title ?? issue.identifier,
    excerpt: composeLinearExcerpt(issue),
    url: issue.url,
    project_match: {
      project_slug: projectSlug,
      matched_by: "linear_project",
    },
    is_mock: false,
  };
}

function composeLinearExcerpt(issue: LinearIssue): string {
  const parts: string[] = [];
  if (issue.identifier) parts.push(issue.identifier);
  if (issue.status) parts.push(issue.status);
  if (issue.priority_label && issue.priority_label !== "No priority") {
    parts.push(issue.priority_label);
  }
  return parts.join(" · ");
}

export function mapGithubCommitsToActivity(
  commits: GithubCommit[],
  repo: string,
  projectSlug: string,
  internalDomains: readonly string[],
): ActivityEvent[] {
  return commits
    .map((c) => mapGithubCommit(c, repo, projectSlug, internalDomains))
    .filter((e): e is ActivityEvent => e !== null);
}

function mapGithubCommit(
  commit: GithubCommit,
  repo: string,
  projectSlug: string,
  internalDomains: readonly string[],
): ActivityEvent | null {
  const sha = commit.sha;
  const date = commit.commit?.author?.date;
  if (!sha || !date) return null;
  const message = commit.commit?.message ?? "";
  const firstLine = message.split("\n", 1)[0]!;
  return {
    id: `github:${repo}:commit:${sha}`,
    source: "github",
    kind: "commit",
    timestamp: date,
    actor: {
      name:
        commit.author?.login ??
        commit.commit?.author?.name ??
        "github",
      handle: commit.author?.login,
      is_external: isExternalEmail(
        commit.commit?.author?.email,
        internalDomains,
      ),
      avatar_url: commit.author?.avatar_url,
    },
    title: firstLine,
    excerpt: `${repo} · ${sha.slice(0, 7)}`,
    url: commit.html_url,
    project_match: { project_slug: projectSlug, matched_by: "github_repo" },
    is_mock: false,
  };
}

export function mapGithubPullsToActivity(
  pulls: GithubPull[],
  repo: string,
  projectSlug: string,
  internalDomains: readonly string[],
): ActivityEvent[] {
  return pulls
    .map((p) => mapGithubPull(p, repo, projectSlug, internalDomains))
    .filter((e): e is ActivityEvent => e !== null);
}

function mapGithubPull(
  pull: GithubPull,
  repo: string,
  projectSlug: string,
  internalDomains: readonly string[],
): ActivityEvent | null {
  const num = pull.number;
  const title = pull.title;
  if (!num || !title) return null;
  const merged = !!pull.merged_at;
  const timestamp =
    pull.merged_at ?? pull.closed_at ?? pull.updated_at ?? pull.created_at;
  if (!timestamp) return null;
  return {
    id: `github:${repo}:pr:${num}`,
    source: "github",
    kind: merged ? "pr-merged" : "pr-opened",
    timestamp,
    actor: pull.user
      ? {
          name: pull.user.login ?? "github",
          handle: pull.user.login,
          // GitHub PR authors don't expose email here; default to internal.
          is_external: false,
          avatar_url: pull.user.avatar_url,
        }
      : undefined,
    title,
    excerpt: `${repo} · #${num}${merged ? " · merged" : ` · ${pull.state ?? "open"}`}`,
    url: pull.html_url,
    project_match: { project_slug: projectSlug, matched_by: "github_repo" },
    is_mock: false,
  };
}

export function mapSlackMessagesToActivity(
  messages: SlackMessage[],
  channelName: string,
  channelId: string,
  projectSlug: string,
  _internalDomains: readonly string[],
): ActivityEvent[] {
  return messages
    .map((m) =>
      mapSlackMessage(m, channelName, channelId, projectSlug),
    )
    .filter((e): e is ActivityEvent => e !== null);
}

function mapSlackMessage(
  msg: SlackMessage,
  channelName: string,
  channelId: string,
  projectSlug: string,
): ActivityEvent | null {
  // Skip auto-generated subtype messages — joins, leaves, archives, etc.
  // — they're noise in a project activity feed.
  if (msg.subtype && SLACK_NOISE_SUBTYPES.has(msg.subtype)) return null;
  if (!msg.ts || !msg.text) return null;
  const tsSec = Number(msg.ts.split(".")[0]);
  if (!Number.isFinite(tsSec)) return null;
  const iso = new Date(tsSec * 1000).toISOString();
  return {
    id: `slack:${channelId}:${msg.ts}`,
    source: "slack",
    kind: "message",
    timestamp: iso,
    actor: msg.username
      ? {
          name: msg.username,
          handle: msg.user,
          // Without email visibility we can't tell internal/external;
          // workspace-internal is the safe default for a8c slack.
          is_external: false,
        }
      : undefined,
    title: truncateText(msg.text, 100),
    excerpt: `#${channelName}`,
    url: msg.permalink,
    project_match: {
      project_slug: projectSlug,
      matched_by: "slack_channel",
    },
    is_mock: false,
  };
}

const SLACK_NOISE_SUBTYPES = new Set([
  "channel_join",
  "channel_leave",
  "channel_archive",
  "channel_unarchive",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "bot_add",
  "bot_remove",
  "pinned_item",
  "unpinned_item",
]);

export function mapZendeskCommentsToActivity(
  comments: ZendeskComment[],
  ticketId: string,
  projectSlug: string,
  internalDomains: readonly string[],
): ActivityEvent[] {
  return comments
    .map((c) => mapZendeskComment(c, ticketId, projectSlug, internalDomains))
    .filter((e): e is ActivityEvent => e !== null);
}

function mapZendeskComment(
  comment: ZendeskComment,
  ticketId: string,
  projectSlug: string,
  internalDomains: readonly string[],
): ActivityEvent | null {
  if (!comment.created_at) return null;
  const body = comment.plain_body ?? comment.body ?? "";
  if (!body.trim()) return null;
  const author = comment.author ?? {};
  // Zendesk's `is_external` flag is sometimes set; prefer it when
  // present, fall back to internal-domain detection on the email.
  const isExternal =
    typeof author.is_external === "boolean"
      ? author.is_external
      : isExternalEmail(author.email, internalDomains);
  return {
    id: `zendesk:${ticketId}:${comment.id ?? comment.created_at}`,
    source: "zendesk",
    kind: "zendesk-comment",
    timestamp: comment.created_at,
    actor: {
      name: author.name ?? "Zendesk",
      handle: author.email,
      is_external: isExternal,
    },
    title: truncateText(body, 100),
    excerpt: `Ticket #${ticketId}`,
    url: zendeskTicketUrl(ticketId),
    project_match: {
      project_slug: projectSlug,
      matched_by: "zendesk_ticket",
    },
    is_mock: false,
  };
}

function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Defensive array unwrap. The upstream MCP responses occasionally have
 * `result` or `notifications` set to something that isn't an array
 * (e.g. an error object) — this guards every mapper against the
 * "x.map is not a function" class of bug.
 */
function asArray<T>(maybe: unknown): T[] {
  return Array.isArray(maybe) ? (maybe as T[]) : [];
}
