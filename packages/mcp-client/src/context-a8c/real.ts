/**
 * Real ContextA8C transport — talks to the user-installed
 * `@automattic/mcp-context-a8c` MCP server via stdio.
 *
 * Coverage today (intentional v1 scope):
 * - listPings → Linear inbox (assignments, comments, mentions). Linear is
 *   the highest-signal "someone needs you" feed in this MCP and maps
 *   cleanly to the Ping shape. Slack DMs / mentions land in a follow-up.
 * - listProjectActivity → not yet wired against the real MCP. Falls back
 *   to a degraded (empty) response so project workbench panels render
 *   without crashing; the caller can layer mock or future real wiring on
 *   top.
 */

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { runIsolated } from "../isolation";
import { StdioMcpClient } from "../stdio-mcp";
import type { ActivityEvent, Ping, SourceResult } from "../types";
import type {
  ContextA8CClient,
  PingsQuery,
  ProjectActivityQuery,
} from "./types";

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
            result.notifications ?? [],
            this.opts.internalEmailDomains,
          );
        },
      },
    );
  }

  async listProjectActivity(
    _query: ProjectActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>> {
    // Per-project activity feed via the real MCP isn't wired yet — needs
    // careful per-source mapping (Slack channel history, Linear project
    // issues, GitHub commits) that's bigger than today's slice. Surface
    // an empty success so the workbench renders without a degraded
    // banner; the per-source "configured" pills already explain that
    // those slots are pending.
    return {
      ok: true,
      data: [],
      from: "fresh",
      fetched_at: new Date().toISOString(),
    };
  }
}

/**
 * Translate a Linear inbox notification into a Ping. Inbox items don't
 * always carry every field, so we degrade gracefully — blank actor,
 * generic excerpt — rather than dropping the row.
 */
export function mapLinearInboxToPings(
  notifications: LinearInboxNotification[],
  internalDomains: readonly string[],
): Ping[] {
  return notifications
    .map((n, i) => mapOne(n, i, internalDomains))
    .filter((p): p is Ping => p !== null);
}

function mapOne(
  n: LinearInboxNotification,
  index: number,
  internalDomains: readonly string[],
): Ping | null {
  const id = n.id ?? `linear-inbox:${n.issue?.identifier ?? index}`;
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
