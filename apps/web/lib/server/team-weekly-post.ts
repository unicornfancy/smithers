import "server-only";

import { loadConfig } from "./config";

/**
 * Try to detect this week's team P2 post URL — the master post each
 * Monday that every TAM comments on with their weekly update. We
 * search the team P2 via WordPress.com's public REST API for posts
 * matching the configured title pattern (default "Week {n}").
 *
 * Returns the post URL when found, or a fallback shape pointing at the
 * team P2 homepage so the UI can still render a link. Auth-required
 * sites that 401 the public API show as `kind: "fallback"` — we'll
 * promote to OAuth-via-ContextA8C when a real need arises.
 */
export interface TeamWeeklyPostResult {
  kind: "found" | "fallback" | "not-configured";
  url: string | null;
  /** Title of the matched post when kind === "found". */
  title?: string;
  /** When kind === "fallback", a short reason ("auth-required", "no-match", "fetch-failed"). */
  reason?: string;
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

  for (const term of searchTerms) {
    const found = await searchWpComPosts(siteHost, term).catch(() => null);
    if (found && found.posts && found.posts.length > 0) {
      // Prefer a title match that includes the literal week number — search
      // is fuzzy, so a "Week 19" query can return adjacent weeks.
      const match = found.posts.find(
        (p) =>
          typeof p.title === "string" &&
          new RegExp(`\\bweek\\s*${weekNumber}\\b`, "i").test(p.title),
      ) ?? found.posts[0];
      if (match?.URL) {
        return {
          kind: "found",
          url: match.URL,
          title: match.title,
        };
      }
    }
  }

  // Couldn't match a post — render a link to the team P2 homepage so the
  // user can still find it manually.
  return {
    kind: "fallback",
    url: teamUrl,
    reason: "no-match",
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
