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
  for (const t of tokens) {
    if (haystack.includes(t)) return true;
  }
  return false;
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
]);
