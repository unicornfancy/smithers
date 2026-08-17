import "server-only";

import { loadConfig } from "./config";
import { getMcpClient } from "./mcp";

/**
 * Try to detect this week's team P2 post URL — the master post each
 * Monday that every TAM comments on with their weekly update.
 *
 * Two lookups per title pattern (default "Week {n}"), in order:
 *   1. Authenticated search via ContextA8C's content-authoring
 *      posts.list — works on private P2s (team51projects is private,
 *      so this is the path that actually fires in production).
 *   2. Public WP.com REST — kept as fallback for public P2s when the
 *      MCP is in mock mode or the session has expired.
 *
 * Returns the post URL when found, or a fallback shape pointing at the
 * team P2 homepage so the UI can still render a link.
 */
export interface TeamWeeklyPostResult {
  kind: "found" | "fallback" | "not-configured";
  url: string | null;
  /** Title of the matched post when kind === "found". */
  title?: string;
  /**
   * When kind === "fallback": "no-match" (search ran, nothing matched),
   * "search-unavailable" (authenticated search errored AND the public
   * API refused — likely an expired MCP session on a private P2), or
   * "unparseable-team-url".
   */
  reason?: string;
  /** Site that was searched — lets the UI say where detection looked. */
  siteHost?: string;
  /** Title search terms tried, in order (patterns with {n} substituted). */
  searchTerms?: string[];
}

interface WpComPost {
  ID?: number;
  URL?: string;
  title?: string;
  date?: string;
}

interface WpComPostsResponse {
  posts?: WpComPost[];
}

export async function detectTeamWeeklyPost(
  weekNumber: number,
): Promise<TeamWeeklyPostResult> {
  const cfg = await loadConfig();
  const teamUrl = cfg.p2?.team_p2_url?.trim();
  if (!teamUrl) {
    return { kind: "not-configured", url: null };
  }
  const siteHost = parseSiteHost(teamUrl);
  if (!siteHost) {
    return { kind: "fallback", url: teamUrl, reason: "unparseable-team-url" };
  }

  // Title patterns from config — substitute {n} with the ISO week.
  const patterns =
    cfg.p2.team_weekly_post_finder?.title_patterns ?? ["Week {n}"];
  const searchTerms = patterns
    .map((p) => p.replace("{n}", String(weekNumber)).trim())
    .filter(Boolean);

  // Prefer a title match that includes the literal week number — search
  // is fuzzy, so a "Week 19" query can return adjacent weeks.
  const weekRe = new RegExp(`\\bweek\\s*${weekNumber}\\b`, "i");

  // Path 1: authenticated search (works on private P2s).
  let mcpSearchFailed = false;
  try {
    const mcp = await getMcpClient();
    for (const term of searchTerms) {
      const hits = await mcp.contextA8C.searchP2Posts({
        site: siteHost,
        search: term,
        per_page: 10,
      });
      const match = hits.find((h) => weekRe.test(h.title)) ?? hits[0];
      if (match?.link) {
        return {
          kind: "found",
          url: match.link,
          title: match.title,
          siteHost,
          searchTerms,
        };
      }
    }
  } catch {
    // MCP unavailable (mock mode / expired session) — public REST below.
    mcpSearchFailed = true;
  }

  // Path 2: public REST (public P2s only; 401s silently on private).
  let publicSearchRan = false;
  for (const term of searchTerms) {
    const found = await searchWpComPosts(siteHost, term).catch(() => null);
    if (!found) continue;
    publicSearchRan = true;
    if (found.posts && found.posts.length > 0) {
      const match = found.posts.find(
        (p) => typeof p.title === "string" && weekRe.test(p.title),
      ) ?? found.posts[0];
      if (match?.URL) {
        return {
          kind: "found",
          url: match.URL,
          title: match.title,
          siteHost,
          searchTerms,
        };
      }
    }
  }

  // Couldn't match a post — render a link to the team P2 homepage so the
  // user can still find it manually. Distinguish "nothing matched" from
  // "we couldn't search at all" so the UI hint points at the right fix.
  return {
    kind: "fallback",
    url: teamUrl,
    reason:
      mcpSearchFailed && !publicSearchRan ? "search-unavailable" : "no-match",
    siteHost,
    searchTerms,
  };
}

async function searchWpComPosts(
  siteHost: string,
  search: string,
): Promise<WpComPostsResponse | null> {
  const url = `https://public-api.wordpress.com/rest/v1.1/sites/${encodeURIComponent(siteHost)}/posts?search=${encodeURIComponent(search)}&number=10&fields=ID,URL,title,date`;
  try {
    const res = await fetch(url, {
      // Public-only call; if the site is private the API returns 401.
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as WpComPostsResponse;
  } catch {
    return null;
  }
}

function parseSiteHost(rawUrl: string): string | null {
  try {
    const u = new URL(
      rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`,
    );
    return u.hostname;
  } catch {
    return null;
  }
}
