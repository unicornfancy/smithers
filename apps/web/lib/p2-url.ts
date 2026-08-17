/**
 * P2 post URL parsing.
 *
 * A project's `p2_url` frontmatter should point at the project's P2
 * post. Shapes we accept:
 *   https://team51projects.wordpress.com/2026/05/12/post-slug/
 *   https://team51projects.wordpress.com/?p=1234        (shortlink)
 *   https://team51projects.wordpress.com/post-slug/     (dateless permalink)
 *
 * A bare site root (no path, no ?p=) is NOT a post — those return
 * null so callers can tell the user to link a specific post.
 *
 * Note on renames: the old addresses redirect in the browser, but
 * ContextA8C's content tools do NOT resolve them — posts.list /
 * posts-text / comments.create against an old host return empty
 * (verified 2026-08 against wpspecialprojectsp2 + to51). Every parsed
 * host is normalized through P2_SITE_RENAMES so stale URLs — pasted,
 * synced from Hive Mind, or in another TAM's vault — keep working.
 *
 * Lives in apps/web (not mcp-client) so client components can import
 * it without dragging transport deps into the bundle.
 */

/** Old P2 host → current host. Old names 404 inside ContextA8C. */
const P2_SITE_RENAMES: Record<string, string> = {
  "wpspecialprojectsp2.wordpress.com": "team51projects.wordpress.com",
  "to51.wordpress.com": "team51.wordpress.com",
};

/** Map a possibly-renamed P2 host to its current name. */
export function normalizeP2Host(host: string): string {
  return P2_SITE_RENAMES[host.toLowerCase()] ?? host;
}

export interface ParsedP2PostUrl {
  /** Bare host, e.g. "team51projects.wordpress.com". */
  site: string;
  /** Post slug (last path segment) when the URL is a permalink. */
  slug?: string;
  /** Numeric post id when the URL is a ?p= shortlink. */
  post_id?: number;
}

export function parseP2PostUrl(input: string | undefined): ParsedP2PostUrl | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const site = normalizeP2Host(url.host);
  if (!site) return null;

  const pParam = url.searchParams.get("p");
  if (pParam && /^\d+$/.test(pParam)) {
    return { site, post_id: Number(pParam) };
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1]!;
  // Date-prefix segments (2026/05/12) are all-numeric; the slug is the
  // last non-numeric segment. A URL ending in a numeric segment with
  // no slug (e.g. /2026/05/) isn't a post link.
  if (/^\d+$/.test(last)) return null;
  return { site, slug: decodeURIComponent(last) };
}
