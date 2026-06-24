import "server-only";

/**
 * Predicate-builder for "did this comment body come from the user?"
 * — used to tell Katie's outbound replies from a partner's inbound
 * inside Zendesk threads, where every Automattic-side reply leaves
 * via the shared concierge@wordpress.com persona and the only
 * reliable author signal is the body's signature line.
 *
 * Matching strategy, in order:
 *   1. Full configured name (multi-word) anywhere in the body — covers
 *      formal signatures like "— Katie McCanna".
 *   2. First word of the configured name in the body's TAIL (last 30%)
 *      — covers casual sign-offs like "Best, / Katie". Tail-only to
 *      avoid false positives from partner greetings ("Hi Katie, ...")
 *      at the top of replies.
 *
 * Returns null when the configured name is empty (caller should treat
 * that as "can't tell — assume partner replied last" to stay safe).
 */
export function makeAuthorNameMatcher(
  rawName: string,
): ((body: string) => boolean) | null {
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  // Always test first-name-in-tail. Catches casual sign-offs that the
  // full-name match would miss.
  const first = parts[0]!;
  const firstRe = new RegExp(`\\b${escapeRegex(first)}\\b`, "i");
  const tailMatches = (body: string): boolean => {
    if (!body) return false;
    const tail = body.slice(Math.floor(body.length * 0.7));
    return firstRe.test(tail);
  };

  if (parts.length === 1) {
    // Configured name is already a single word — tail-only avoids the
    // partner-greeting trap ("Hi Katie, ..." up top).
    return tailMatches;
  }

  // Multi-word: try the full name anywhere first, then fall back to
  // first-name-in-tail. Either path is "yes, it's me."
  const fullRe = new RegExp(`\\b${escapeRegex(trimmed)}\\b`, "i");
  return (body) => fullRe.test(body) || tailMatches(body);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
