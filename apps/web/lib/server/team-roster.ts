import "server-only";

import type { MatticspaceGroupRoster } from "@smithers/mcp-client";

import { getMcpClient } from "@/lib/server/mcp";
import { readMyVoiceFile, writeMyVoiceFile } from "@/lib/server/my-voice";

/**
 * Sync a Matticspace group's roster into JOB_CONTEXT.md's
 * "Common collaborators" section.
 *
 * Idempotent. Updates only the auto-managed block delimited by
 * `<!-- BEGIN matticspace-<slug> -->` / `<!-- END matticspace-<slug> -->`
 * comments. User-edited content outside the markers (intro paragraphs,
 * notes after the roster) is preserved.
 *
 * On first sync, the markers are inserted at the bottom of the
 * "Common collaborators" section (before the next `## ` heading or EOF).
 *
 * Returns a summary the scheduler job can log + the run-now button can
 * surface.
 */
export interface TeamRosterSyncResult {
  ok: boolean;
  /** Total members synced across every group attempted. */
  members_synced: number;
  /** True when at least one group's block actually changed on disk. */
  changed: boolean;
  /** Per-group rows so the caller can surface per-block status. */
  groups?: { slug: string; members: number; changed: boolean; error?: string }[];
  /** Set when the overall sync failed (e.g. missing file). */
  error?: string;
}

const FILENAME = "JOB_CONTEXT.md";
const SECTION_HEADING = "## Common collaborators";

/**
 * Multi-group orchestrator. Each group gets its own BEGIN/END marker
 * block inside the Common collaborators section, so the user can mix
 * an FT team with a contractors group, a cross-team initiative, etc.
 */
export async function syncTeamRostersToJobContext(opts: {
  groupSlugs: string[];
  includeSubteams?: boolean;
}): Promise<TeamRosterSyncResult> {
  if (opts.groupSlugs.length === 0) {
    return { ok: false, members_synced: 0, changed: false, error: "no group slugs configured" };
  }
  const perGroup: NonNullable<TeamRosterSyncResult["groups"]> = [];
  let totalMembers = 0;
  let anyChanged = false;
  for (const slug of opts.groupSlugs) {
    const result = await syncTeamRosterToJobContext({
      groupSlug: slug,
      includeSubteams: opts.includeSubteams,
    });
    perGroup.push({
      slug,
      members: result.members_synced,
      changed: result.changed,
      error: result.error,
    });
    totalMembers += result.members_synced;
    if (result.changed) anyChanged = true;
  }
  const anyFailed = perGroup.some((g) => g.error);
  return {
    ok: !anyFailed,
    members_synced: totalMembers,
    changed: anyChanged,
    groups: perGroup,
    error: anyFailed
      ? perGroup
          .filter((g) => g.error)
          .map((g) => `${g.slug}: ${g.error}`)
          .join("; ")
      : undefined,
  };
}

export async function syncTeamRosterToJobContext(opts: {
  groupSlug: string;
  includeSubteams?: boolean;
}): Promise<TeamRosterSyncResult> {
  const mcp = await getMcpClient();
  const rosterResult = await mcp.contextA8C.listMatticspaceGroupMembers(
    opts.groupSlug,
    { includeSubteams: opts.includeSubteams ?? true },
  );
  if (!rosterResult.ok) {
    return {
      ok: false,
      members_synced: 0,
      changed: false,
      error: rosterResult.error.message,
    };
  }
  const roster = rosterResult.data;

  const current = (await readMyVoiceFile(FILENAME)) ?? "";
  if (!current) {
    return {
      ok: false,
      members_synced: 0,
      changed: false,
      error: `${FILENAME} is empty — create it first with at least a "${SECTION_HEADING}" section.`,
    };
  }

  const updated = updateCollaboratorsBlock(current, roster);
  if (updated === current) {
    return {
      ok: true,
      members_synced: roster.members.length,
      changed: false,
    };
  }

  await writeMyVoiceFile(FILENAME, updated);
  return {
    ok: true,
    members_synced: roster.members.length,
    changed: true,
  };
}

function updateCollaboratorsBlock(
  source: string,
  roster: MatticspaceGroupRoster,
): string {
  const beginMarker = `<!-- BEGIN matticspace-${roster.group_slug} -->`;
  const endMarker = `<!-- END matticspace-${roster.group_slug} -->`;
  const block = renderRosterBlock(roster, beginMarker, endMarker);

  // Case 1: markers already exist — replace whatever's between them.
  if (source.includes(beginMarker) && source.includes(endMarker)) {
    const before = source.slice(0, source.indexOf(beginMarker));
    const afterStart = source.indexOf(endMarker) + endMarker.length;
    const after = source.slice(afterStart);
    return `${before}${block}${after}`;
  }

  // Case 2: section exists but no markers yet — insert at bottom of section.
  const lines = source.split("\n");
  const sectionIdx = lines.findIndex(
    (l) => l.trim() === SECTION_HEADING,
  );
  if (sectionIdx === -1) {
    // Case 3: no section at all — append one at the end.
    const suffix = source.endsWith("\n") ? "" : "\n";
    return `${source}${suffix}\n${SECTION_HEADING}\n\n${block}\n`;
  }

  // Find the end of the section (next `## ` or EOF).
  let endOfSection = lines.length;
  for (let i = sectionIdx + 1; i < lines.length; i += 1) {
    if (lines[i]!.startsWith("## ")) {
      endOfSection = i;
      break;
    }
  }

  // Drop trailing blank lines inside the section so the inserted block
  // butts up cleanly against existing content.
  let insertAt = endOfSection;
  while (insertAt > sectionIdx + 1 && lines[insertAt - 1]!.trim() === "") {
    insertAt -= 1;
  }

  const before = lines.slice(0, insertAt).join("\n");
  const after = lines.slice(insertAt).join("\n");
  return `${before}\n\n${block}\n\n${after}`;
}

function decodeHtmlEntities(input: string): string {
  // Matticspace returns job titles / bios with HTML-encoded entities
  // (e.g. "Engineer &amp; Advocate"). Decode the common ones so the
  // markdown output reads cleanly.
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function renderRosterBlock(
  roster: MatticspaceGroupRoster,
  beginMarker: string,
  endMarker: string,
): string {
  // Leads first, then alphabetical by first name.
  const sorted = [...roster.members].sort((a, b) => {
    if (a.is_team_lead !== b.is_team_lead) return a.is_team_lead ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const lines: string[] = [];
  lines.push(beginMarker);
  lines.push(`<!-- Auto-synced from ${roster.group_url || `matticspace group ${roster.group_slug}`}. Edits inside these markers are overwritten on the next sync. -->`);
  lines.push("");
  for (const m of sorted) {
    const parts: string[] = [];
    parts.push(`- **${decodeHtmlEntities(m.name)}**`);
    if (m.wp_username) parts.push(`(${m.wp_username})`);
    parts.push("—");
    parts.push(decodeHtmlEntities(m.job_title) || "Team member");
    // Skip team_group when it's empty, equal to the group name, or
    // the literal "None" — matticspace returns "None" for members
    // who aren't in a sub-team (e.g. the contractors group). The
    // job_title usually carries the meaningful info in those cases.
    const teamGroup = decodeHtmlEntities(m.team_group).trim();
    if (
      teamGroup &&
      teamGroup.toLowerCase() !== "none" &&
      teamGroup !== roster.group_name
    ) {
      parts.push(`· \`${teamGroup}\``);
    }
    if (m.is_team_lead) parts.push("· lead");
    lines.push(parts.join(" "));
  }
  lines.push("");
  lines.push(`_${roster.members.length} member${roster.members.length === 1 ? "" : "s"} synced from ${roster.group_url || roster.group_slug}._`);
  lines.push(endMarker);
  return lines.join("\n");
}
