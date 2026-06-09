import type { CallRecordingRef } from "@smithers/mcp-client";

import { AppHeader } from "@/components/app-header";
import { CallsTable } from "@/components/calls-table";
import { PageShell } from "@/components/page-shell";
import { getMcpClient } from "@/lib/server/mcp";
import { loadPartnerContactsBySlug } from "@/lib/server/partner-contacts";
import { recordingMatchesProject } from "@/lib/server/recording-match";
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

  const partnerContactsBySlug = await loadPartnerContactsBySlug(
    vault,
    projects,
  );

  const rows: CallRow[] = recordings.map((rec) => ({
    recording: rec,
    matchedProjects: projects
      .filter((p) => {
        if (p.kind !== "partner" && p.kind !== "team") return false;
        const signals = partnerContactsBySlug.get(p.slug);
        return recordingMatchesProject(rec, {
          ...p,
          partner_contact_emails: signals?.emails,
          partner_contact_names: signals?.names,
        });
      })
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

