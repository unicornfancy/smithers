/**
 * Pure name-cleanup helpers matching the team51 CLI's own slugify
 * rules. Kept in a plain (non-server) module so both server actions
 * and client-side dialog previews can call them without violating
 * Next.js's "use server" async-only rule.
 *
 * References:
 *   ~/team51-cli/commands/WPCOM_Site_Create.php line 81
 *     — WPCOM strips dashes: `str_replace('-', '', slugify($x))`.
 *   ~/team51-cli/commands/Pressable_Site_Create.php line 84
 *     — Pressable preserves dashes: `slugify($x)`.
 */

/**
 * WPCOM site name — lowercase alphanumeric only. Dashes are
 * stripped (WPCOM subdomains don't allow them).
 */
export function cleanWpcomName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    // Drop combining marks
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

/**
 * Pressable site name — lowercase, dashes preserved between runs
 * of non-alphanumeric characters. Trims leading / trailing dashes
 * so the CLI doesn't reject `-foo-` style inputs.
 */
export function cleanPressableName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
