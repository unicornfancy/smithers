/** Convert a free-form name into a kebab-case slug suitable for filenames. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Drop the `.md` extension from a filename if present. */
export function withoutMdExt(name: string): string {
  return name.replace(/\.md$/i, "");
}

/** Pull the first H1 heading from a markdown body, if present. */
export function extractFirstHeading(body: string): string | undefined {
  const match = body.match(/^#\s+(.+?)\s*$/m);
  return match ? match[1] : undefined;
}

const GENERIC_SLUG_TOKENS = new Set([
  "phase",
  "redesign",
  "migration",
  "rebuild",
  "launch",
  "site",
  "new",
  "old",
  "project",
  "v1",
  "v2",
  "v3",
]);

/**
 * Detect slugs that are too generic to identify a project on their own —
 * `phase-2`, `redesign`, `new-site`, etc. Used by the import flow to combine
 * partner + project into a more specific slug, and by UI to warn users when
 * they're about to commit a name that will collide in follow-up matching.
 */
export function isGenericSlug(slug: string): boolean {
  const trimmed = slug.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed.length < 6) return true;
  const tokens = trimmed.split("-").filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length === 1) return GENERIC_SLUG_TOKENS.has(tokens[0]!);
  // Multi-token: generic if every token is either a generic word or a
  // 1–2-digit number (e.g. "phase-2", "v-1", "site-2").
  return tokens.every(
    (t) => GENERIC_SLUG_TOKENS.has(t) || /^\d{1,2}$/.test(t),
  );
}
