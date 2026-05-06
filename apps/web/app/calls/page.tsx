import type { CallRecordingRef } from "@smithers/mcp-client";
import type { Project } from "@smithers/vault";

import { AppHeader } from "@/components/app-header";
import { CallsTable } from "@/components/calls-table";
import { PageShell } from "@/components/page-shell";
import { getMcpClient } from "@/lib/server/mcp";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "Calls · Smithers",
};

export const dynamic = "force-dynamic";

export interface CallRow {
  recording: CallRecordingRef;
  /** Projects that match this recording, in display order. */
  matchedProjects: { slug: string; name: string }[];
}

export default async function CallsPage() {
  const vault = await getVault();
  const mcp = await getMcpClient();

  const [projects, recordingsResult] = await Promise.all([
    vault.listProjects().catch(() => []),
    mcp.fathom.listRecordings({ limit: 50 }),
  ]);

  const recordings = recordingsResult.ok
    ? recordingsResult.data
    : (recordingsResult.cachedData ?? []);

  const rows: CallRow[] = recordings.map((rec) => ({
    recording: rec,
    matchedProjects: projects
      .filter(
        (p) =>
          (p.kind === "partner" || p.kind === "team") &&
          recordingMatchesProject(rec, p),
      )
      .map((p) => ({ slug: p.slug, name: p.name })),
  }));

  const matched = rows.filter((r) => r.matchedProjects.length > 0);
  const unmatched = rows.filter((r) => r.matchedProjects.length === 0);

  const projectPicker = projects
    .filter((p) => p.kind === "partner" || p.kind === "team")
    .map((p) => ({ slug: p.slug, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <AppHeader
        title="Calls"
        subtitle={`${recordings.length} recent recordings · ${unmatched.length} unmatched`}
      />
      <PageShell>
        <CallsTable
          matched={matched}
          unmatched={unmatched}
          projectPicker={projectPicker}
        />
      </PageShell>
    </>
  );
}

/**
 * Same logic as the project-workbench filter — kept colocated so the two
 * surfaces stay in sync. Splits project name + partner slug + display
 * name + curated fathom_search_terms into ≥3-char tokens, then checks
 * whether any token appears in the recording's title or attendees
 * string. Attendees catch calendar-link meetings where the title is
 * generic but the partner email gives it away.
 */
function recordingMatchesProject(
  recording: { title?: string; attendees?: string },
  project: Project,
): boolean {
  if (!recording.title && !recording.attendees) return false;
  const haystack = `${recording.title ?? ""} ${recording.attendees ?? ""}`.toLowerCase();
  const tokens = new Set<string>();
  for (const s of [
    project.name,
    project.partner,
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
]);
