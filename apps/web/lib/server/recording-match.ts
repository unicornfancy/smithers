import "server-only";

/**
 * Shared "does this Fathom recording belong to this project" matcher.
 * Used by /today (RecentCallsCard), /calls (CallsTable), and the project
 * workbench (Recent Calls section). Keeping a single source of truth
 * means stop-word changes and the per-project exclusion mechanism are
 * picked up everywhere at once.
 *
 * Strategy: split the project's name + partner slug + (optional) partner
 * display name + curated `fathom_search_terms` into ≥3-char tokens,
 * filter by `STOP_TOKENS`, then check whether any token appears in the
 * recording's title or attendees string. Attendees catch calendar-link
 * meetings where the title is generic but a partner email gives the
 * affiliation away (e.g. `grant@thepocketnyc.com` → contains "pocket").
 *
 * False-positive prone for short common tokens, hence STOP_TOKENS. The
 * remaining false positives — anything sharing a non-stopped token —
 * are handled by `fathom_excluded_recording_ids` in project frontmatter:
 * any recording_id in that list is excluded for that project regardless
 * of how many tokens match.
 */
export function recordingMatchesProject(
  recording: { recording_id?: string; title?: string; attendees?: string },
  project: {
    name: string;
    partner?: string;
    partner_display_name?: string;
    fathom_search_terms?: string[];
    fathom_excluded_recording_ids?: string[];
    /**
     * Emails from the partner's HM partner-knowledge.md `contacts: []`
     * frontmatter. Tokenized to domain mid-segments — e.g.
     * `martin@thepocketnyc.com` contributes the `thepocketnyc` token,
     * not `martin` or `com`. The local-part is intentionally dropped
     * because first names are too generic to discriminate partners.
     */
    partner_contact_emails?: string[];
    /**
     * Partner contact full names (from the same `contacts: []`
     * frontmatter). Each name is added to the token set as a
     * *phrase* — e.g. `"Martin Porter"` becomes a single
     * `"martin porter"` substring lookup. This catches the
     * calendar-link case where the meeting title is generic
     * ("Automattic Special Projects - Katie McCanna (Martin Porter)")
     * but the partner contact's name appears verbatim. Single-word
     * names are dropped because first-name collisions across partners
     * are too common.
     */
    partner_contact_names?: string[];
  },
): boolean {
  if (!recording.title && !recording.attendees) return false;

  // Hard exclusion: user has marked this recording as "not this project"
  // via the Detach button on the workbench. Always wins over token match.
  if (
    recording.recording_id &&
    project.fathom_excluded_recording_ids?.includes(recording.recording_id)
  ) {
    return false;
  }

  const haystack =
    `${recording.title ?? ""} ${recording.attendees ?? ""}`.toLowerCase();
  const tokens = new Set<string>();
  for (const s of [
    project.name,
    project.partner,
    project.partner_display_name,
    ...(project.fathom_search_terms ?? []),
  ]) {
    if (!s) continue;
    for (const t of s.toLowerCase().split(/[\s\-_/.]+/)) {
      if (t.length >= 3 && !STOP_TOKENS.has(t)) tokens.add(t);
    }
  }
  for (const email of project.partner_contact_emails ?? []) {
    for (const t of extractEmailDomainTokens(email)) {
      if (t.length >= 3 && !STOP_TOKENS.has(t)) tokens.add(t);
    }
  }
  for (const name of project.partner_contact_names ?? []) {
    const cleaned = name.trim().toLowerCase();
    // Multi-word names go in as a phrase — "martin porter" stays joined
    // so the haystack must contain the full sequence, not just "martin"
    // or "porter" alone (which collide across partners). Single-word
    // names (e.g. just "Martin") are skipped.
    if (cleaned.split(/\s+/).length >= 2) tokens.add(cleaned);
  }
  for (const t of tokens) {
    if (haystack.includes(t)) return true;
  }
  return false;
}

/**
 * Pull discriminating tokens from an email's domain — i.e. drop the
 * local-part (`martin`) and the TLD (`com`), keep the middle segments
 * (`thepocketnyc`, plus subdomains if present). The local-part is
 * almost always too generic (a first name or "info" / "support"),
 * and TLDs match every email; the middle is where partner identity
 * actually lives.
 */
function extractEmailDomainTokens(email: string): string[] {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return [];
  const domain = trimmed.slice(at + 1);
  if (!domain) return [];
  const parts = domain.split(".").filter(Boolean);
  if (parts.length <= 1) return parts;
  return parts.slice(0, -1);
}

const STOP_TOKENS = new Set([
  "the",
  "and",
  "for",
  "phase",
  "project",
  "foundation",
  "inc",
  "llc",
  "corp",
  "team",
  // WordPress / web boilerplate — too generic to discriminate between
  // partner projects (e.g. "Body Dao Acupuncture New Site" claimed
  // "Automattic + Neighborhood Nip: Dev Site Review" via "site").
  "site",
  "page",
  "new",
  "old",
  "wordpress",
  "wp",
  "web",
  "review",
  "dev",
  "redesign",
  "migration",
  "build",
  // Common TLDs that survive the >=3-char filter from the email-domain
  // token path. Without these, every email contributes a `com` / `org`
  // token and the matcher matches every recording.
  "com",
  "org",
  "net",
  "app",
]);
