/**
 * Helpers for parsing the loose `zendesk_tickets` frontmatter field.
 * Each entry can be a raw numeric id ("11134851") or a full ticket
 * URL ("https://automattic.zendesk.com/agent/tickets/11134851"); we
 * accept both and reduce to a clean numeric id whenever possible.
 *
 * Lives separately from the transport so the form, the activity
 * fetcher, and the threads-panel renderer all share the same parsing.
 */

const TICKET_PATH_RE = /\/(?:agent\/)?tickets?\/(\d+)/i;

/**
 * Extract a numeric ticket id from a frontmatter ref. Returns null
 * when nothing usable is present (so the caller can decide to drop
 * the ref or surface a warning).
 */
export function extractTicketId(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  // Try parsing as a URL; fall back to regex on the raw string for
  // partial paths.
  try {
    const url = new URL(trimmed);
    const m = url.pathname.match(TICKET_PATH_RE);
    if (m) return m[1]!;
  } catch {
    // Not a valid URL — try the regex anyway in case it's a partial path.
  }
  const match = trimmed.match(TICKET_PATH_RE);
  return match ? match[1]! : null;
}

/**
 * Build the canonical Automattic Zendesk URL for a ticket id. Used
 * for "Open in Zendesk" links on the threads panel.
 */
export function zendeskTicketUrl(ticketId: string): string {
  return `https://automattic.zendesk.com/agent/tickets/${ticketId}`;
}

export interface ParsedTicketRef {
  /** Numeric id when extractable; the original string otherwise. */
  id: string;
  /** Whether we successfully resolved a numeric id. */
  resolved: boolean;
}

/** Convenience: parse + tag every ref in an array. */
export function parseTicketRefs(refs: readonly string[]): ParsedTicketRef[] {
  const seen = new Set<string>();
  const out: ParsedTicketRef[] = [];
  for (const ref of refs) {
    const id = extractTicketId(ref);
    const resolved = id !== null;
    const key = id ?? ref.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, resolved });
  }
  return out;
}
