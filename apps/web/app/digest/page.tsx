import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/page-shell";
import { PersonalDevelopmentCard } from "@/components/personal-development-card";
import { WeeklyHighlightCard } from "@/components/weekly-highlight-card";
import { isoWeekId, isoWeekParts } from "@/lib/server/weekly-facts";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "Personal Digest · Smithers",
};

export const dynamic = "force-dynamic";

export default async function DigestPage() {
  const vault = await getVault();
  const today = new Date();
  const thisWeekId = isoWeekId(today);
  const { week: thisWeekNumber } = isoWeekParts(today);

  const [thisHighlight, pastHighlights, development] = await Promise.all([
    vault.readWeeklyHighlight(thisWeekId).catch(() => null),
    vault.listWeeklyHighlights().catch(() => []),
    vault.readPersonalDevelopment().catch(() => null),
  ]);

  const historyExcludingCurrent = pastHighlights
    .filter((h) => h.iso_week !== thisWeekId)
    .sort((a, b) => b.iso_week.localeCompare(a.iso_week));

  return (
    <>
      <AppHeader
        title="Personal Digest"
        subtitle={`Weekly highlight + development tracker · Week ${thisWeekNumber}`}
      />
      <PageShell>
        <WeeklyHighlightCard
          isoWeek={thisWeekId}
          weekNumber={thisWeekNumber}
          initialBody={thisHighlight?.body ?? ""}
          initialSavedAt={thisHighlight?.frontmatter?.last_saved_at ?? null}
          relativePath={thisHighlight?.relative_path}
          history={historyExcludingCurrent.map((h) => ({
            iso_week: h.iso_week,
            week: h.week,
            relative_path: h.relative_path,
            modified_at: h.modified_at,
          }))}
        />
        <PersonalDevelopmentCard
          initialBody={development?.body ?? ""}
          relativePath={development?.relative_path}
          modifiedAt={development?.modified_at ?? null}
        />
      </PageShell>
    </>
  );
}
