/**
 * Linear project URL parsing.
 *
 * Linear project URLs look like:
 *   https://linear.app/<workspace>/project/<slug-with-trailing-id>
 *   https://linear.app/<workspace>/project/<slug-with-trailing-id>/overview
 *
 * The slug format is `<kebab-name>-<short-id>` where `<short-id>` is the
 * 8–12 character hex segment Linear's API accepts as the project `id`.
 * Lives in apps/web (not @smithers/mcp-client) so it's safe to import from
 * client components — the mcp-client barrel pulls in stdio transport code
 * that breaks the client bundle.
 */

export interface ParsedLinearProjectUrl {
  /** Full slug as it appears in the URL path (after `/project/`). */
  slug: string;
  /** Short id parsed from the trailing hex segment of the slug, if present. */
  id?: string;
}

const URL_RE = /^https?:\/\/linear\.app\/[^/]+\/projects?\/([^/?#]+)/i;
const TRAILING_ID_RE = /-([a-f0-9]{8,})$/i;

export function parseLinearProjectUrl(
  input: string,
): ParsedLinearProjectUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = URL_RE.exec(trimmed);
  if (!match) return null;
  const slug = decodeURIComponent(match[1]!);
  if (/^[a-f0-9]{8,}$/i.test(slug)) {
    return { slug, id: slug };
  }
  const idMatch = TRAILING_ID_RE.exec(slug);
  return idMatch ? { slug, id: idMatch[1]! } : { slug };
}
