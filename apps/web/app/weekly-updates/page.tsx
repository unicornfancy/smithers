import { AppHeader } from "@/components/app-header";
import { PageShell, PlaceholderCard } from "@/components/page-shell";

export const metadata = {
  title: "Weekly Updates · Smithers",
};

export default function WeeklyUpdatesPage() {
  return (
    <>
      <AppHeader
        title="Weekly Updates"
        subtitle="ISO-week archive of weekly P2 updates"
      />
      <PageShell>
        <PlaceholderCard
          title="Weekly updates index"
          description="Two-column editor (markdown + source-data sidebar). Auto-generated Monday morning by the briefing job, then refined inline. Posts to P2 with a mandatory review gate."
          todo={[
            "Generate via packages/agents weekly-update prompt",
            "Verify @handles via ContextA8C before posting",
            "Diff posted vs draft → append rules to Style Guide on commit",
          ]}
        />
      </PageShell>
    </>
  );
}
