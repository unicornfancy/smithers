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
  MatticspaceGroupMember,
  MatticspaceGroupRoster,
  P2Post,
  P2PostAuthor,
  P2PostFetchQuery,
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
const MATTICSPACE_ROSTER_TTL = { freshMs: 60 * 60 * 1000 } as const;

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
  /** Some context-a8c response shapes wrap data here. */
  result?: LinearIssue[] | { issues?: LinearIssue[] };
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

interface GithubIssue {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  body?: string | null;
  updated_at?: string;
  created_at?: string;
  user?: { login?: string; avatar_url?: string };
  /** Present when the issue is actually a PR. Filter these out. */
  pull_request?: unknown;
}
interface GithubIssuesResult {
  result?: GithubIssue[];
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
  /** Older response shape; newer get-ticket-comments tool omits this. */
  author?: ZendeskAuthor;
  /** Newer response shape — author identifier without name/email. */
  author_id?: number | string;
  /**
   * Newer response shape — name + email come through here when the
   * comment was sent via email channel. Web channel comments only have
   * a `to` block (Katie's outgoing replies), so falls back to nothing
   * and the mapper uses internal-domain detection on absent email.
   */
  via?: {
    channel?: string;
    source?: {
      from?: { address?: string; name?: string };
      to?: { address?: string; name?: string };
    };
  };
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
            this.opts.selfEmail,
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
      tasks.push(this.fetchGithubIssues(query));
    }
    if (allow("slack") && query.refs.slack_channel) {
      tasks.push(this.fetchSlackMessages(query));
    }
    if (allow("zendesk") && (query.refs.zendesk_tickets ?? []).length > 0) {
      // One task per ticket so each thread caches independently and a
      // 404 on one ticket doesn't poison the others.
      for (const ref of query.refs.zendesk_tickets!) {
        tasks.push(this.fetchZendeskTicketComments(query, ref));
      }
    }
    if (allow("p2") && query.refs.p2_url) {
      // Two complementary P2 paths, both anchored on the partner's own P2:
      //
      //   - fetchP2Comments: posts + comments on the partner's P2 itself
      //   - fetchP2Mentions: posts on OTHER team P2s that link back to the
      //     partner's P2 (cross-post signal — narrower + higher signal
      //     than a name-keyword search).
      //
      // Both feed the "p2" source filter; consumers tell them apart by
      // event.kind (p2-post / p2-comment vs p2-mention).
      tasks.push(this.fetchP2Comments(query));
      tasks.push(this.fetchP2Mentions(query));
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
            extractLinearIssues(result),
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
    const [owner, name] = normalizeGithubRepo(repo);
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
    const [owner, name] = normalizeGithubRepo(repo);
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

  private async fetchGithubIssues(
    query: ProjectActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>> {
    const repo = query.refs.github_repo!;
    const [owner, name] = normalizeGithubRepo(repo);
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
        cacheKey: `real:context_a8c:project_activity:github_issues:${repo}`,
        ttl: ACTIVITY_TTL,
        fetcher: async () => {
          // Try ContextA8C first; fall back to direct REST if the tool
          // isn't exposed or the session is expired.
          let issues: GithubIssue[] | null = null;
          try {
            const result = await this.mcp.callJsonTool<GithubIssuesResult>(
              "context-a8c-execute-tool",
              {
                provider: "github",
                tool: "issues",
                // Provider rejects "all" / lowercase — needs "OPEN" or
                // "CLOSED". Open issues are the activity-feed signal.
                params: { owner, repo: name, state: "OPEN", perPage: 10 },
              },
            );
            const raw = asArray<GithubIssue>(result?.result);
            // Only use the ContextA8C result if it actually returned items
            // — an empty array might mean "tool exists but no issues", but
            // a null result means the tool wasn't found.
            if (result !== null) {
              issues = raw;
            }
          } catch {
            // ContextA8C session expired or tool not found — fall through.
          }

          if (issues === null) {
            // Fall back to GitHub REST API.
            const token = process.env.GITHUB_TOKEN;
            if (!token) return [];
            const url = `https://api.github.com/repos/${owner}/${name}/issues?state=all&sort=updated&direction=desc&per_page=10`;
            const res = await fetch(url, {
              headers: {
                Authorization: `token ${token}`,
                Accept: "application/vnd.github.v3+json",
              },
            });
            if (!res.ok) return [];
            const raw = (await res.json()) as GithubIssue[];
            issues = Array.isArray(raw) ? raw : [];
          }

          // Filter out PRs — GitHub issues endpoint returns both.
          const pureIssues = issues.filter((i) => !i.pull_request);
          return mapGithubIssuesToActivity(
            pureIssues,
            repo,
            query.project_slug,
          );
        },
      },
    );
  }

  private async fetchSlackMessages(
    query: ProjectActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>> {
    const channelName = query.refs.slack_channel!;
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
              tool: "get-ticket-comments",
              params: { ticketId: Number(ticketId), includePrivate: false },
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
   * Fetch recent posts + their approved comments from the partner's own
   * P2 via `wpcom/posts-text { include_comments: true }`. Each comment
   * becomes a `p2-comment` ActivityEvent; the post itself becomes a
   * `p2-post`. Goes through runIsolated so a failed P2 fetch doesn't
   * poison the rest of the activity feed.
   *
   * The May 28 cut (1538a03) removed an earlier version that tried
   * public WP.com REST and 401'd on internal P2s. The provider has
   * since grown the `include_comments` flag, closing the gap.
   *
   * The standalone `fetchP2Posts` method (below) does slug/id-targeted
   * fetches; this one is the date-windowed activity-feed variant.
   */
  private async fetchP2Comments(
    query: ProjectActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>> {
    const site = normalizeP2Site(query.refs.p2_url!);
    if (!site) {
      return failedResult(
        "context_a8c.p2",
        "invalid",
        `Bad p2_url "${query.refs.p2_url}"`,
      );
    }
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "context_a8c.p2",
        cacheKey: `real:context_a8c:project_activity:p2_posts:${site}`,
        ttl: ACTIVITY_TTL,
        fetcher: async () => {
          const after = new Date();
          after.setUTCDate(after.getUTCDate() - 14);
          const result = await this.mcp.callJsonTool<P2PostsTextEnvelope>(
            "context-a8c-execute-tool",
            {
              provider: "wpcom",
              tool: "posts-text",
              params: {
                site,
                per_page: 10,
                after: after.toISOString(),
                include_comments: true,
                max_comments_per_post: 20,
              },
            },
          );
          const posts = (result?.posts ?? [])
            .map(mapP2PostRaw)
            .filter((p): p is P2Post => p !== null);
          return mapP2PostsToActivity(
            posts,
            site,
            query.project_slug,
            this.opts.internalEmailDomains,
          );
        },
      },
    );
  }

  /**
   * Cross-post discovery via `mgs/search`. Finds posts on OTHER team P2s
   * that link back to the partner's P2 host — a much higher-signal
   * filter than searching for the partner's name (which hit common
   * words like "the" and "pocket" and dragged in unrelated chatter).
   *
   * Querying the host string ("foo.wordpress.com") narrows results to
   * documents that actually reference the partner's P2 by URL. Misses
   * legitimate prose mentions (no URL) but that's the right trade —
   * those are usually accompanied by a URL anyway when the team is
   * cross-posting.
   *
   * Requires p2_url; the dispatch above gates this branch on it.
   */
  private async fetchP2Mentions(
    query: ProjectActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>> {
    // Use the raw p2_url as the search needle — this is the project's
    // specific P2 post URL ("…/2026/05/15/foo/"), not the partner's host.
    // mgs/search scores documents that contain the URL substring, so
    // we get tight matches to actual cross-posts of this exact thread
    // rather than every post that mentions the partner's domain.
    //
    // If a user sets a bare host as p2_url, the search degrades to
    // host-string matching — broader, but their choice.
    const postUrl = query.refs.p2_url!.trim();
    if (!postUrl) {
      return failedResult(
        "context_a8c.p2",
        "invalid",
        `Empty p2_url`,
      );
    }
    const site = normalizeP2Site(postUrl);
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "context_a8c.p2",
        cacheKey: `real:context_a8c:project_activity:p2_crossposts:${postUrl}`,
        ttl: ACTIVITY_TTL,
        fetcher: async () => {
          const dateFrom = new Date();
          dateFrom.setUTCDate(dateFrom.getUTCDate() - 14);
          const result = await this.mcp.callJsonTool<MgsSearchResult>(
            "context-a8c-execute-tool",
            {
              provider: "mgs",
              tool: "search",
              params: {
                query: postUrl,
                // Posts likely carry the cross-post URL; comments occasionally
                // do too. Leave content_type unset so both surface.
                date_from: dateFrom.toISOString().slice(0, 10),
                per_page: 10,
                sort: "date_desc",
              },
            },
          );
          // mgs/search tokenizes the query (splits on /, ., etc.) so the
          // raw response still includes loose keyword matches. Filter
          // post-hoc to only keep hits whose own URL or excerpt
          // literally references the project's p2_url — that's the
          // actual cross-post signal.
          //
          // Compare against a normalized form (no trailing slash, no
          // scheme) so http vs https or a trailing / doesn't lose
          // legitimate matches.
          const needle = stripUrlNoise(postUrl);
          const hits = asArray<MgsHit>(result?.results).filter((h) => {
            // Drop hits originating on the partner's own P2 — already
            // covered by fetchP2Comments.
            if (site && h.url?.includes(site) && h.url === postUrl) {
              return false;
            }
            const corpus = [
              h.url ?? "",
              h.post_url ?? "",
              h.excerpt ?? "",
              h.title ?? "",
              h.post_title ?? "",
            ]
              .map(stripUrlNoise)
              .join(" ");
            return needle.length > 0 && corpus.includes(needle);
          });
          return mapMgsResultsToActivity(
            hits,
            postUrl,
            query.project_slug,
            this.opts.internalEmailDomains,
          );
        },
      },
    );
  }

  async listGithubMentionPings(
    repos: string[],
    handle: string,
  ): Promise<Ping[]> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return [];

    const results = await Promise.allSettled(
      repos.map(async (repo) => {
        const [owner, name] = normalizeGithubRepo(repo);
        if (!owner || !name) return [] as Ping[];
        const url = `https://api.github.com/repos/${owner}/${name}/issues?state=open&mentions=${handle}&per_page=10`;
        const res = await fetch(url, {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        });
        if (!res.ok) return [] as Ping[];
        const raw = (await res.json()) as GithubIssue[];
        const issues = Array.isArray(raw)
          ? raw.filter((i) => !i.pull_request)
          : [];
        return issues
          .map((issue): Ping | null => {
            if (!issue.number || !issue.updated_at) return null;
            const excerpt = issue.body
              ? issue.body.slice(0, 200)
              : (issue.title ?? "");
            return {
              id: `github:${repo}:issue:${issue.number}:mention`,
              source: "github",
              timestamp: issue.updated_at,
              from: {
                name: issue.user?.login ?? "github",
                handle: issue.user?.login,
                is_external: true,
              },
              excerpt,
              url: issue.html_url,
              project_match: undefined,
              is_mock: false,
            };
          })
          .filter((p): p is Ping => p !== null);
      }),
    );

    const out: Ping[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") out.push(...r.value);
    }
    return out;
  }

  async getLinearProjectMetadata(refs: {
    project_id?: string;
    project_slug?: string;
  }): Promise<import("./types").LinearProjectMetadata | null> {
    const key = refs.project_id ?? refs.project_slug;
    if (!key) return null;
    // Linear's MCP exposes a "project" singular tool the same way the
    // listProjectActivity flow uses "issues". If this turns out to be
    // missing in the upstream we'll fall back via search like we did
    // for Zendesk.
    try {
      const result = await this.mcp.callJsonTool<{
        project?: Record<string, unknown>;
        result?: Record<string, unknown>;
      }>("context-a8c-execute-tool", {
        provider: "linear",
        tool: "project",
        params: refs.project_id
          ? { id: refs.project_id }
          : { slug: refs.project_slug },
      });
      if (!result) return null;
      const p = (result.project ?? result.result ?? result) as Record<string, unknown>;
      const id = typeof p["id"] === "string" ? (p["id"] as string) : null;
      const name = typeof p["name"] === "string" ? (p["name"] as string) : null;
      if (!id || !name) return null;
      const stateRaw = p["state"] ?? p["status"];
      const state =
        typeof stateRaw === "string"
          ? stateRaw
          : typeof stateRaw === "object" && stateRaw !== null
            ? typeof (stateRaw as Record<string, unknown>)["name"] === "string"
              ? ((stateRaw as Record<string, unknown>)["name"] as string)
              : undefined
            : undefined;
      const leadRaw = p["lead"];
      const lead =
        typeof leadRaw === "object" && leadRaw !== null
          ? typeof (leadRaw as Record<string, unknown>)["name"] === "string"
            ? ((leadRaw as Record<string, unknown>)["name"] as string)
            : undefined
          : typeof leadRaw === "string"
            ? leadRaw
            : undefined;
      return {
        id,
        name,
        slug: typeof p["slug"] === "string" ? (p["slug"] as string) : undefined,
        description:
          typeof p["description"] === "string" ? (p["description"] as string) : undefined,
        state,
        target_date:
          typeof p["target_date"] === "string"
            ? (p["target_date"] as string)
            : typeof p["targetDate"] === "string"
              ? (p["targetDate"] as string)
              : undefined,
        lead,
        url: typeof p["url"] === "string" ? (p["url"] as string) : undefined,
        health: typeof p["health"] === "string" ? (p["health"] as string) : undefined,
        progress: typeof p["progress"] === "number" ? (p["progress"] as number) : undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Public per-ticket comments fetch — used by the merged Threads panel
   * to render a "Recent activity" disclosure under each ticket. We
   * reuse the same upstream tool the activity feed uses, but unwrap
   * the SourceResult here so the caller gets a plain array (or empty
   * on failure — the disclosure is decorative, not load-bearing).
   */
  async fetchZendeskTicketActivity(
    ticketRef: string,
    opts: { limit?: number; projectSlug?: string } = {},
  ): Promise<ActivityEvent[]> {
    const ticketId = extractTicketId(ticketRef);
    if (!ticketId) return [];
    try {
      const result = await this.mcp.callJsonTool<ZendeskCommentsResult>(
        "context-a8c-execute-tool",
        {
          provider: "zendesk",
          tool: "get-ticket-comments",
          params: { ticketId: Number(ticketId), includePrivate: false },
        },
      );
      const events = mapZendeskCommentsToActivity(
        asArray<ZendeskComment>(result?.comments ?? result?.result),
        ticketId,
        opts.projectSlug ?? "",
        this.opts.internalEmailDomains,
      );
      // Newest first — comments come back oldest-first from Zendesk.
      return events.sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp),
      );
    } catch {
      return [];
    }
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

    // First try a single-ticket fetch tool. We previously probed and
    // got "Tool not found" but the provider has evolved (e.g. the
    // get-ticket-comments swap), so try the most likely names first
    // and fall through silently if none exist.
    for (const tool of ["get-ticket", "ticket", "show-ticket"]) {
      const summary = await this.tryFetchZendeskTicketTool(tool, ticketId).catch(
        () => null,
      );
      if (summary) return summary;
    }

    // Fall back to deriving a subject from the first comment's
    // plain_body — get-ticket-comments is the only confirmed-working
    // endpoint. Subject derived this way is just the first line / 80
    // chars; status stays null until a search-driven refresh runs.
    const derivedSubject = await this.deriveSubjectFromComments(ticketId).catch(
      () => null,
    );
    return {
      id: ticketId,
      subject: derivedSubject,
      status: null,
      priority: null,
      updated_at: null,
      url: zendeskTicketUrl(ticketId),
    };
  }

  private async tryFetchZendeskTicketTool(
    tool: string,
    ticketId: string,
  ): Promise<ZendeskTicketSummary | null> {
    const result = await this.mcp.callJsonTool<ZendeskTicketResult>(
      "context-a8c-execute-tool",
      {
        provider: "zendesk",
        tool,
        params: { ticketId: Number(ticketId) },
      },
    );
    const t = result?.ticket ?? result?.result;
    if (!t) return null;
    const rawId = t.id ?? t.ticket_id;
    const id = typeof rawId === "number" ? String(rawId) : typeof rawId === "string" ? rawId : ticketId;
    return {
      id,
      subject: typeof t.subject === "string" ? t.subject : null,
      status: typeof t.status === "string" ? t.status : null,
      priority: typeof t.priority === "string" ? t.priority : null,
      updated_at: typeof t.updated_at === "string" ? t.updated_at : null,
      url: zendeskTicketUrl(id),
    };
  }

  private async deriveSubjectFromComments(
    ticketId: string,
  ): Promise<string | null> {
    const result = await this.mcp.callJsonTool<ZendeskCommentsResult>(
      "context-a8c-execute-tool",
      {
        provider: "zendesk",
        tool: "get-ticket-comments",
        params: { ticketId: Number(ticketId), includePrivate: false },
      },
    );
    const comments = asArray<ZendeskComment>(result?.comments ?? result?.result);
    if (comments.length === 0) return null;
    // Comments come back oldest-first; the first one is usually the
    // partner's original email. plain_body has the body without headers,
    // so derive a one-line subject from it.
    const first = comments[0]!;
    const body = decodeHtmlEntities(first.plain_body ?? first.body ?? "");
    const firstLine = body.split(/\n/).find((l) => l.trim().length > 0)?.trim();
    if (!firstLine) return null;
    return firstLine.length > 80
      ? firstLine.slice(0, 79).trimEnd() + "…"
      : firstLine;
  }

  async fetchZendeskTicketSummaries(
    refs: string[],
    opts: { searchHint?: string } = {},
  ): Promise<ZendeskTicketSummary[]> {
    if (refs.length === 0) return [];
    const ids = refs
      .map((r) => extractTicketId(r))
      .filter((id): id is string => Boolean(id));
    const degradedFor = (id: string): ZendeskTicketSummary => ({
      id,
      subject: null,
      status: null,
      priority: null,
      updated_at: null,
      url: zendeskTicketUrl(id),
    });
    if (!opts.searchHint || ids.length === 0) {
      return ids.map(degradedFor);
    }

    // One bulk search using the hint (typically the partner's display
    // name); we then index by ticket_id and look up each ref. Tickets
    // that don't appear in the search hits get a degraded row so the
    // panel still renders them — the user can refresh later if needed.
    const result = await this.searchZendeskTickets(opts.searchHint, {
      limit: 50,
    });
    if (!result.ok) {
      return ids.map(degradedFor);
    }
    const byId = new Map<string, ZendeskTicketSummary>();
    for (const t of result.tickets) byId.set(t.id, t);
    return ids.map((id) => byId.get(id) ?? degradedFor(id));
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

  // ---- Phase H: extra-context URL resolvers --------------------------------

  async resolveSlackUrl(url: string): Promise<{
    type: "slack-thread" | "slack-message";
    label: string;
    body: string;
  } | null> {
    if (!url || !/^https?:\/\/[^/]*\.slack\.com\//i.test(url)) return null;
    try {
      const result = await this.mcp.callJsonTool<SlackGetResult>(
        "context-a8c-execute-tool",
        { provider: "slack", tool: "get", params: { url } },
      );
      if (!result) return null;
      // The slack/get tool returns either a single message or a thread
      // (array of messages). Detect by presence of `messages` vs `text`.
      const messages = Array.isArray(result.messages)
        ? result.messages
        : result.message
          ? [result.message]
          : null;
      if (!messages || messages.length === 0) return null;
      // Detect a thread by either multiple messages OR a thread_ts marker
      // on the first message — single-message thread permalinks should
      // still label as "thread".
      const isThread =
        messages.length > 1 || Boolean((messages[0] as { thread_ts?: string })?.thread_ts);
      // Slack `get` returns `channel` as a plain string (channel name) for
      // most workspaces. Older shapes or other workspaces may emit an
      // object — handle both.
      const channelLabel =
        typeof result.channel === "string"
          ? `#${result.channel}`
          : result.channel?.name
            ? `#${result.channel.name}`
            : (result.channel?.id ?? "slack");
      const head = messages[0]!;
      const headSnippet = (head.text ?? "").slice(0, 80).replace(/\s+/g, " ");
      const label = isThread
        ? `Slack thread in ${channelLabel} — ${headSnippet}`
        : `Slack message in ${channelLabel} — ${headSnippet}`;
      const body = messages
        .map((m) => {
          const who = m.user_name ?? m.username ?? m.user ?? "unknown";
          return `${who}: ${m.text ?? ""}`;
        })
        .join("\n\n");
      return {
        type: isThread ? "slack-thread" : "slack-message",
        label,
        body,
      };
    } catch {
      return null;
    }
  }

  async resolveGithubUrl(url: string): Promise<{
    type: "github-issue-comment";
    label: string;
    body: string;
  } | null> {
    const parsed = parseGithubIssueUrl(url);
    if (!parsed) return null;
    try {
      // GitHub provider responses wrap the payload in `{ result: ... }` —
      // an object for `get` and an array for `get_comments`. Unwrap before
      // reading title/body/user/comments.
      const headRaw = await this.mcp.callJsonTool<GithubReadEnvelope>(
        "context-a8c-execute-tool",
        {
          provider: "github",
          tool: parsed.kind === "pull" ? "pull-request" : "issue",
          params:
            parsed.kind === "pull"
              ? { owner: parsed.owner, repo: parsed.repo, pullNumber: parsed.number, method: "get" }
              : { owner: parsed.owner, repo: parsed.repo, issue_number: parsed.number, method: "get" },
        },
      );
      const head = (headRaw?.result ?? headRaw) as GithubIssueOrPr | null;
      if (!head) return null;
      const commentsRaw = await this.mcp
        .callJsonTool<GithubReadEnvelope>("context-a8c-execute-tool", {
          provider: "github",
          tool: parsed.kind === "pull" ? "pull-request" : "issue",
          params:
            parsed.kind === "pull"
              ? { owner: parsed.owner, repo: parsed.repo, pullNumber: parsed.number, method: "get_comments" }
              : { owner: parsed.owner, repo: parsed.repo, issue_number: parsed.number, method: "get_comments" },
        })
        .catch(() => null);
      const commentItems: GithubComment[] = Array.isArray(commentsRaw?.result)
        ? commentsRaw!.result
        : Array.isArray(commentsRaw)
          ? (commentsRaw as GithubComment[])
          : [];

      const title = head.title ?? `${parsed.kind === "pull" ? "PR" : "Issue"} #${parsed.number}`;
      const headBodyText = head.body ?? "";
      const headAuthor = head.user?.login ?? "unknown";
      // CodeRabbit / dependabot comments are noisy boilerplate that bloat
      // the agent prompt without adding signal — drop them.
      const commentBlocks = commentItems
        .filter((c) => {
          const login = c.user?.login ?? "";
          return !/coderabbit|dependabot|copilot/i.test(login);
        })
        .map((c) => {
          const who = c.user?.login ?? "unknown";
          return `${who}: ${(c.body ?? "").trim()}`;
        });
      const lines = [
        `# ${title}`,
        `${headAuthor}: ${headBodyText}`.trim(),
        ...commentBlocks,
      ];
      return {
        type: "github-issue-comment",
        label: `${parsed.kind === "pull" ? "PR" : "Issue"} ${parsed.owner}/${parsed.repo}#${parsed.number} — ${title}`,
        body: lines.join("\n\n"),
      };
    } catch {
      return null;
    }
  }

  async checkZendeskTicketActioned(
    ticketRef: string,
    sinceTs: string,
  ): Promise<boolean> {
    const events = await this.fetchZendeskTicketActivity(ticketRef);
    return events.some(
      (e) => e.actor && !e.actor.is_external && e.timestamp > sinceTs,
    );
  }

  async checkSlackActioned(
    url: string,
    sinceTs: string,
    slackHandle: string,
  ): Promise<boolean> {
    if (!url || !slackHandle.trim()) return false;
    if (!/^https?:\/\/[^/]*\.slack\.com\//i.test(url)) return false;
    const target = slackHandle.trim().toLowerCase().replace(/^@/, "");
    const sinceMs = Date.parse(sinceTs);
    if (Number.isNaN(sinceMs)) return false;
    try {
      const result = await this.mcp.callJsonTool<SlackGetResult>(
        "context-a8c-execute-tool",
        { provider: "slack", tool: "get", params: { url } },
      );
      const messages = Array.isArray(result?.messages)
        ? result!.messages
        : result?.message
          ? [result.message]
          : null;
      if (!messages) return false;
      return messages.some((m) => slackMessageMatches(m, target, sinceMs));
    } catch {
      return false;
    }
  }

  async checkGithubIssueActioned(
    url: string,
    sinceTs: string,
    login: string,
  ): Promise<boolean> {
    const parsed = parseGithubIssueUrl(url);
    if (!parsed || !login.trim()) return false;
    const targetLogin = login.toLowerCase();
    try {
      const commentsRaw = await this.mcp.callJsonTool<GithubReadEnvelope>(
        "context-a8c-execute-tool",
        {
          provider: "github",
          tool: parsed.kind === "pull" ? "pull-request" : "issue",
          params:
            parsed.kind === "pull"
              ? {
                  owner: parsed.owner,
                  repo: parsed.repo,
                  pullNumber: parsed.number,
                  method: "get_comments",
                }
              : {
                  owner: parsed.owner,
                  repo: parsed.repo,
                  issue_number: parsed.number,
                  method: "get_comments",
                },
        },
      );
      const comments: GithubComment[] = Array.isArray(commentsRaw?.result)
        ? commentsRaw!.result
        : Array.isArray(commentsRaw)
          ? (commentsRaw as GithubComment[])
          : [];
      return comments.some(
        (c) =>
          c.user?.login?.toLowerCase() === targetLogin &&
          (c.created_at ?? "") > sinceTs,
      );
    } catch {
      return false;
    }
  }

  async listMatticspaceGroupMembers(
    groupSlug: string,
    opts: { includeSubteams?: boolean } = {},
  ): Promise<SourceResult<MatticspaceGroupRoster>> {
    const includeSubteams = opts.includeSubteams ?? false;
    const cacheKey = `real:context_a8c:matticspace:group_members:${groupSlug}:${includeSubteams}`;
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "context_a8c.linear",
        cacheKey,
        ttl: MATTICSPACE_ROSTER_TTL,
        fetcher: async () => {
          const raw = await this.mcp.callJsonTool<MatticspaceGroupMembersRaw>(
            "context-a8c-execute-tool",
            {
              provider: "matticspace",
              tool: "list-group-members",
              params: {
                group: groupSlug,
                include_subteams: includeSubteams,
                returned_fields: [
                  "name",
                  "wp_username",
                  "job_title",
                  "team_group",
                  "is_team_lead",
                  "matticspace_url",
                ],
              },
            },
          );
          return mapMatticspaceGroupRoster(raw, groupSlug);
        },
      },
    );
  }

  /**
   * Fetch posts from a single A8C P2 via the wpcom provider's
   * `posts-text` tool. Supports per-slug / per-id targeting plus
   * inline comments. Internal P2s (wpspecialprojectsp2, to51) are
   * reachable because ContextA8C runs under the user's A8C session.
   *
   * Defensive: returns [] on any failure (auth, parse, network) so
   * callers can degrade — typical use is "if this comes back empty,
   * fall back to the user's pasted text".
   */
  async fetchP2Posts(query: P2PostFetchQuery): Promise<P2Post[]> {
    const site = normalizeP2Site(query.site);
    if (!site) return [];
    if (!query.slugs?.length && !query.ids?.length) return [];

    const params: Record<string, unknown> = {
      site,
      include_comments: query.include_comments ?? false,
    };
    if (query.ids?.length) {
      params.ids = query.ids.slice(0, 100);
    } else if (query.slugs?.length) {
      params.slugs = query.slugs.slice(0, 100);
    }
    if (query.include_comments && query.max_comments_per_post) {
      params.max_comments_per_post = Math.min(
        Math.max(1, query.max_comments_per_post),
        500,
      );
    }

    try {
      const result = await this.mcp.callJsonTool<P2PostsTextEnvelope>(
        "context-a8c-execute-tool",
        { provider: "wpcom", tool: "posts-text", params },
      );
      const posts = result?.posts ?? [];
      return posts.map(mapP2PostRaw).filter((p): p is P2Post => p !== null);
    } catch {
      return [];
    }
  }
}

interface P2PostsTextEnvelope {
  posts?: Array<Record<string, unknown>>;
}

function normalizeP2Site(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(
      trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
    );
    return parsed.host || null;
  } catch {
    return null;
  }
}

function mapP2PostRaw(raw: Record<string, unknown>): P2Post | null {
  const id = typeof raw["id"] === "number" ? raw["id"] : null;
  if (id === null) return null;
  const author = mapAuthorRaw(raw["author"]);
  const commentsRaw = Array.isArray(raw["comments"])
    ? (raw["comments"] as Array<Record<string, unknown>>)
    : [];
  const comments = commentsRaw
    .map((c) => {
      const cid = typeof c["id"] === "number" ? c["id"] : null;
      if (cid === null) return null;
      return {
        id: cid,
        author: mapAuthorRaw(c["author"]),
        date: typeof c["date"] === "string" ? (c["date"] as string) : "",
        content_text:
          typeof c["content_text"] === "string"
            ? (c["content_text"] as string)
            : "",
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
  return {
    id,
    link: typeof raw["link"] === "string" ? (raw["link"] as string) : "",
    date: typeof raw["date"] === "string" ? (raw["date"] as string) : "",
    modified:
      typeof raw["modified"] === "string" ? (raw["modified"] as string) : "",
    author,
    title: typeof raw["title"] === "string" ? (raw["title"] as string) : "",
    content_text:
      typeof raw["content_text"] === "string"
        ? (raw["content_text"] as string)
        : "",
    excerpt:
      typeof raw["excerpt"] === "string" ? (raw["excerpt"] as string) : "",
    comments,
    comments_total:
      typeof raw["comments_total"] === "number"
        ? (raw["comments_total"] as number)
        : comments.length,
    comments_truncated: Boolean(raw["comments_truncated"]),
  };
}

function mapAuthorRaw(raw: unknown): { username: string; display_name: string } {
  if (typeof raw !== "object" || raw === null) {
    return { username: "", display_name: "" };
  }
  const r = raw as Record<string, unknown>;
  return {
    username: typeof r["username"] === "string" ? (r["username"] as string) : "",
    display_name:
      typeof r["display_name"] === "string" ? (r["display_name"] as string) : "",
  };
}

interface MatticspaceGroupMembersRaw {
  group?: {
    name?: string;
    slug?: string;
    url?: string;
  };
  total_members?: number;
  members?: Array<{
    name?: string;
    wp_username?: string;
    job_title?: string;
    team_group?: string;
    is_team_lead?: boolean;
    matticspace_url?: string;
  }>;
}

function mapMatticspaceGroupRoster(
  raw: MatticspaceGroupMembersRaw | null | undefined,
  fallbackSlug: string,
): MatticspaceGroupRoster {
  const members: MatticspaceGroupMember[] = (raw?.members ?? []).map((m) => ({
    name: m.name ?? "",
    wp_username: m.wp_username ?? "",
    job_title: m.job_title ?? "",
    team_group: m.team_group ?? "",
    is_team_lead: Boolean(m.is_team_lead),
    matticspace_url: m.matticspace_url ?? "",
  }));
  return {
    group_slug: raw?.group?.slug ?? fallbackSlug,
    group_name: raw?.group?.name ?? "",
    group_url: raw?.group?.url ?? "",
    total_members: raw?.total_members ?? members.length,
    members,
  };
}

interface SlackGetResult {
  channel?: string | { id?: string; name?: string };
  message?: SlackMessage;
  messages?: SlackMessage[];
}
interface SlackMessage {
  text?: string;
  user?: string;
  username?: string;
  user_name?: string;
  /** Slack timestamp — Unix epoch seconds with sub-second, e.g. "1715000000.000100". */
  ts?: string;
  thread_ts?: string;
}

function slackMessageMatches(
  m: SlackMessage,
  target: string,
  sinceMs: number,
): boolean {
  const author = (m.user_name ?? m.username ?? m.user ?? "")
    .toLowerCase()
    .replace(/^@/, "");
  if (!author || author !== target) return false;
  if (!m.ts) return false;
  const messageMs = Number.parseFloat(m.ts) * 1000;
  if (!Number.isFinite(messageMs)) return false;
  return messageMs > sinceMs;
}
interface GithubIssueOrPr {
  number?: number;
  title?: string;
  body?: string;
  user?: { login?: string };
  state?: string;
  html_url?: string;
}
interface GithubComment {
  id?: number;
  body?: string;
  user?: { login?: string };
  created_at?: string;
}
interface GithubReadEnvelope {
  /** GitHub provider responses wrap the payload here. */
  result?: GithubIssueOrPr | GithubComment[];
}

/**
 * Parse a github.com URL pointing at an issue or pull request, including
 * direct links to comments (`#issuecomment-<id>`) and review comments.
 * Returns owner/repo/number/kind so the caller can dispatch to the right
 * MCP tool.
 */
function parseGithubIssueUrl(
  url: string,
): { owner: string; repo: string; number: number; kind: "issue" | "pull" } | null {
  const match = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/i.exec(
    url,
  );
  if (!match) return null;
  const [, owner, repo, kindRaw, numStr] = match;
  const number = Number.parseInt(numStr!, 10);
  if (!Number.isFinite(number)) return null;
  return {
    owner: owner!,
    repo: repo!,
    number,
    kind: kindRaw === "pull" ? "pull" : "issue",
  };
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
  selfEmail: string = "",
): Ping[] {
  const self = selfEmail.trim().toLowerCase();
  const seen = new Set<string>();
  const out: Ping[] = [];
  for (let i = 0; i < notifications.length; i++) {
    const n = notifications[i]!;
    // Drop "you posted X" / "you changed status" / "you commented" type
    // notifications — Linear surfaces these in the inbox even though
    // they don't represent inbound work waiting on the user.
    if (self && n.actor?.email?.toLowerCase() === self) continue;
    // Drop notification types that are pure broadcasts — no link to
    // act on, no waiting reply, just noise in the panel.
    if (NOISE_LINEAR_NOTIFICATION_TYPES.has(n.type ?? "")) continue;
    const ping = mapOne(n, i, internalDomains);
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
    project_match: buildLinearProjectMatch(n.issue?.project),
    is_mock: false,
  };
}

/**
 * Linear notification types that don't represent inbound work — they're
 * informational broadcasts with no action expected. Keep this list
 * tight: only types that are *purely* noise. When in doubt, prefer to
 * leave the notification in (the user can dismiss individual rows).
 */
const NOISE_LINEAR_NOTIFICATION_TYPES = new Set<string>([
  // "User X posted an update on Project Y" — no link to act on, no
  // mention, just a follower broadcast.
  "projectUpdateCreated",
]);

function buildLinearProjectMatch(
  project: { name?: string; slug?: string; id?: string } | undefined,
): import("../types").ProjectMatch | undefined {
  if (!project || (!project.slug && !project.id && !project.name)) return undefined;
  // We don't know the vault slug at transport time — leave in_vault=false
  // and stash project name + Linear UUID so /today can resolve to a
  // vault project (or render the name as a non-link label when there
  // isn't one yet).
  return {
    project_slug: project.slug ?? project.id ?? project.name ?? "",
    matched_by: "linear_project",
    display_label: project.name,
    in_vault: false,
    linear_project_id: project.id,
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

export function mapGithubIssuesToActivity(
  issues: GithubIssue[],
  repo: string,
  projectSlug: string,
): ActivityEvent[] {
  return issues
    .map((i) => mapGithubIssue(i, repo, projectSlug))
    .filter((e): e is ActivityEvent => e !== null);
}

function mapGithubIssue(
  issue: GithubIssue,
  repo: string,
  projectSlug: string,
): ActivityEvent | null {
  const num = issue.number;
  const title = issue.title;
  const timestamp = issue.updated_at ?? issue.created_at;
  if (!num || !title || !timestamp) return null;
  const kind: ActivityEvent["kind"] =
    issue.state === "closed" ? "issue-closed" : "issue-opened";
  return {
    id: `github:${repo}:issue:${num}`,
    source: "github",
    kind,
    timestamp,
    actor: issue.user
      ? {
          name: issue.user.login ?? "github",
          handle: issue.user.login,
          is_external: false,
          avatar_url: issue.user.avatar_url,
        }
      : undefined,
    title: `#${num}: ${title}`,
    excerpt: issue.body ? issue.body.slice(0, 200) : undefined,
    url: issue.html_url,
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
  const body = decodeHtmlEntities(
    comment.plain_body ?? comment.body ?? "",
  );
  if (!body.trim()) return null;
  // The newer get-ticket-comments tool omits `comment.author` and instead
  // exposes the sender via `via.source.from.{address,name}` for inbound
  // (email-channel) comments. Web-channel comments (the user's own
  // outgoing replies) have no `from` block; treat those as internal.
  const author = comment.author ?? {};
  const fromBlock = comment.via?.source?.from;
  const name = author.name ?? fromBlock?.name ?? "Zendesk";
  const email = author.email ?? fromBlock?.address;
  const isExternal =
    typeof author.is_external === "boolean"
      ? author.is_external
      : email
        ? isExternalEmail(email, internalDomains)
        : false; // web-channel comment with no from-address = internal reply
  return {
    id: `zendesk:${ticketId}:${comment.id ?? comment.created_at}`,
    source: "zendesk",
    kind: "zendesk-comment",
    timestamp: comment.created_at,
    actor: {
      name,
      handle: email,
      is_external: isExternal,
    },
    title: truncateText(body, 100),
    excerpt: body,
    url: zendeskTicketUrl(ticketId),
    project_match: {
      project_slug: projectSlug,
      matched_by: "zendesk_ticket",
    },
    is_mock: false,
  };
}

/**
 * Decode the HTML entities Zendesk's `plain_body` field embeds (chiefly
 * &nbsp;) so the rendered text doesn't show literal entity strings.
 * Covers the common five — anything else passes through unchanged.
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// --- P2 (wpcom posts-text + mgs search) ---------------------------------
//
// Two activity-feed paths share these helpers:
//
//   - fetchP2Comments uses the existing wpcom posts-text shape (P2Post +
//     P2PostComment from ./types.ts), plus the existing mapP2PostRaw /
//     normalizeP2Site helpers (defined alongside the standalone
//     fetchP2Posts method earlier in this file). Only the activity-event
//     mapper is new.
//   - fetchP2Mentions consumes the mgs/search response shape, which is
//     net-new to this codebase.

interface MgsHit {
  type?: "post" | "page" | "comment";
  title?: string;
  post_title?: string;
  url?: string;
  post_url?: string;
  date?: string;
  author?: string;
  blog_name?: string;
  blog_id?: number;
  post_id?: number;
  comment_id?: number;
  excerpt?: string;
  score?: number;
}

interface MgsSearchResult {
  results?: MgsHit[];
}

/**
 * Strip scheme + trailing slash from a URL-ish string for substring
 * comparison. `https://foo.com/bar/` and `http://foo.com/bar` both
 * normalize to `foo.com/bar`, so a literal-include check survives
 * http/https drift and trailing slashes.
 */
function stripUrlNoise(s: string): string {
  return s.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

function p2PlainContent(s: string | undefined): string {
  if (!s) return "";
  // posts-text already returns plaintext, but mgs excerpts can carry
  // entity-encoded characters from the indexed HTML. Decode + collapse
  // the runaway whitespace we saw in probe output (\n\n\n\n\n…).
  return decodeHtmlEntities(s).replace(/\s+/g, " ").trim();
}

function p2AuthorDisplay(author: P2PostAuthor): string {
  return author.display_name?.trim() || author.username?.trim() || "P2";
}

export function mapP2PostsToActivity(
  posts: P2Post[],
  p2Domain: string,
  projectSlug: string,
  _internalDomains: readonly string[],
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const post of posts) {
    if (post.date) {
      events.push({
        id: `p2:${p2Domain}:post:${post.id}`,
        source: "p2",
        kind: "p2-post",
        timestamp: post.date,
        actor: {
          name: p2AuthorDisplay(post.author),
          handle: post.author.username || undefined,
          // P2 authors are all Automatticians; no external case to flag.
          is_external: false,
        },
        title: truncateText(decodeHtmlEntities(post.title || "(untitled)"), 120),
        excerpt: truncateText(p2PlainContent(post.excerpt || post.content_text), 240),
        url: post.link,
        project_match: {
          project_slug: projectSlug,
          matched_by: "p2_url",
        },
        is_mock: false,
      });
    }
    for (const c of post.comments) {
      if (!c.date) continue;
      const body = p2PlainContent(c.content_text);
      if (!body) continue;
      events.push({
        id: `p2:${p2Domain}:comment:${c.id}`,
        source: "p2",
        kind: "p2-comment",
        timestamp: c.date,
        actor: {
          name: p2AuthorDisplay(c.author),
          handle: c.author.username || undefined,
          is_external: false,
        },
        title: truncateText(body, 120),
        excerpt: body,
        url: post.link,
        project_match: {
          project_slug: projectSlug,
          matched_by: "p2_url",
        },
        is_mock: false,
      });
    }
  }
  return events;
}

export function mapMgsResultsToActivity(
  hits: MgsHit[],
  matchedHost: string,
  projectSlug: string,
  _internalDomains: readonly string[],
): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const h of hits) {
    if (!h.date) continue;
    const url = h.url ?? h.post_url;
    if (!url) continue;
    const postTitle = h.post_title ?? h.title ?? "P2 post";
    const excerpt = p2PlainContent(h.excerpt);
    const idTail = h.comment_id ?? h.post_id ?? `${h.blog_id}:${h.date}`;
    out.push({
      id: `p2-mention:${h.blog_id ?? "unknown"}:${idTail}`,
      source: "p2",
      kind: "p2-mention",
      timestamp: h.date,
      actor: h.author ? { name: h.author, is_external: false } : undefined,
      // Lead with the host P2 so the row reads "<blog> · <post title>"
      // — clearly distinguishes a cross-post linking back to the partner's
      // P2 from comments on the partner's own P2.
      title: truncateText(`${h.blog_name ?? "P2"} · ${postTitle}`, 140),
      excerpt: excerpt
        ? truncateText(excerpt, 240)
        : `Cross-posts ${matchedHost}`,
      url,
      project_match: {
        project_slug: projectSlug,
        matched_by: "p2_url",
      },
      is_mock: false,
    });
  }
  return out;
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

/**
 * Accept either the bare `owner/repo` form or a full
 * `https://github.com/owner/repo[/...]` URL (with optional trailing
 * `.git`, branch, or path) and return `[owner, repo]`. Returns
 * `[undefined, undefined]` when neither form matches so callers keep
 * their existing degradation branch. Reason: project frontmatter
 * has historically been inconsistent — some entries store the URL,
 * others the slug.
 */
/**
 * Pull the issues array out of whichever response shape the
 * context-a8c Linear tool happens to use. We've seen `{ issues: [...] }`,
 * `{ result: [...] }`, and `{ result: { issues: [...] } }` in the wild
 * for different providers; try them all rather than guess.
 */
function extractLinearIssues(result: LinearIssuesResult | null): LinearIssue[] {
  if (!result) return [];
  if (Array.isArray(result.issues)) return result.issues;
  if (Array.isArray(result.result)) return result.result;
  if (result.result && typeof result.result === "object" && Array.isArray((result.result as { issues?: LinearIssue[] }).issues)) {
    return (result.result as { issues: LinearIssue[] }).issues;
  }
  return [];
}

function normalizeGithubRepo(raw: string): [string | undefined, string | undefined] {
  if (!raw) return [undefined, undefined];
  const trimmed = raw.trim().replace(/\.git$/i, "");
  const urlMatch = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)/i.exec(trimmed);
  if (urlMatch) return [urlMatch[1]!, urlMatch[2]!];
  const parts = trimmed.split("/");
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return [parts[0], parts[1]];
  }
  return [undefined, undefined];
}
