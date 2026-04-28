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
