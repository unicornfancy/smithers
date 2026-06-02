import type { PaletteEntry, PaletteEntryKind } from "@/lib/server/palette-index";

/**
 * Token-based scoring for the Ask Smithers palette. No fuzzy library —
 * we just split the query on whitespace and score each token against
 * the entry's label + description with a prefix > substring ranking.
 *
 * Per design doc:
 *
 *     score = label_score * 3 + description_score * 1
 *           + kind_boost(kind) + recency_boost(last_touched_at)
 *
 * `label_score` and `description_score` accumulate per-token: each query
 * token contributes one of {exact-word=5, prefix-word=3, substring=1, 0}
 * — picking the strongest. Tokens that don't match anywhere score 0
 * but don't disqualify the entry (so "pocket" still finds "the pocket nyc"
 * even if a typo'd second token doesn't land).
 */
export function scoreEntry(query: string, entry: PaletteEntry): number {
  const tokens = tokenize(query);
  if (tokens.length === 0) return baseScore(entry);

  const labelScore = tokens.reduce(
    (sum, t) => sum + tokenScore(t, entry.label),
    0,
  );
  const descScore = tokens.reduce(
    (sum, t) => sum + tokenScore(t, entry.description ?? ""),
    0,
  );

  // Require at least one token to actually hit somewhere; otherwise the
  // entry is irrelevant for this query.
  if (labelScore === 0 && descScore === 0) return 0;

  return labelScore * 3 + descScore + baseScore(entry);
}

function baseScore(entry: PaletteEntry): number {
  return kindBoost(entry.kind) + recencyBoost(entry.last_touched_at);
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function tokenScore(token: string, target: string): number {
  if (!target) return 0;
  const haystack = target.toLowerCase();
  const words = haystack.split(/\s+|[\-_/]/).filter(Boolean);

  let best = 0;
  for (const w of words) {
    if (w === token) {
      best = Math.max(best, 5);
    } else if (w.startsWith(token)) {
      best = Math.max(best, 3);
    }
  }
  if (best === 0 && haystack.includes(token)) {
    best = 1;
  }
  return best;
}

function kindBoost(kind: PaletteEntryKind): number {
  switch (kind) {
    case "project-vault":
      return 3;
    case "follow-up":
      return 2;
    case "page":
      return 1.5;
    case "partner-hm":
      return 1;
    case "project-hm":
      return 0.5;
  }
}

function recencyBoost(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  const daysAgo = (Date.now() - t) / (1000 * 60 * 60 * 24);
  if (daysAgo < 1) return 2;
  if (daysAgo < 7) return 1;
  if (daysAgo < 30) return 0.5;
  return 0;
}

/**
 * Filter + rank entries against a query. Pure fn — easy to test in
 * isolation and to swap in unit smokes.
 */
export function rankEntries(
  query: string,
  entries: PaletteEntry[],
  limit = 40,
): Array<{ entry: PaletteEntry; score: number }> {
  const scored = entries
    .map((entry) => ({ entry, score: scoreEntry(query, entry) }))
    .filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
