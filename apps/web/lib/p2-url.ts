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
 * Note on renames: wpspecialprojects.wordpress.com was renamed to
 * team51projects.wordpress.com (2026-07). WordPress.com keeps the old
 * address routing to the same site server-side, so URLs under either
 * name resolve — no migration required for API calls.
 *
 * Lives in apps/web (not mcp-client) so client components can import
 * it without dragging transport deps into the bundle.
 */

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
  const site = url.host;
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
