import { AppHeader } from "@/components/app-header";
import { PageShell, PlaceholderCard } from "@/components/page-shell";

export const metadata = {
  title: "Style Guide · Smithers",
};

export default function StyleGuidePage() {
  return (
    <>
      <AppHeader
        title="Style Guide"
        subtitle="Templates and learned voice rules"
      />
      <PageShell>
        <PlaceholderCard
          title="Templates"
          description="Editable canonical templates: project brief email, P2 call notes, partner welcome, weekly update — populated from ~/Documents/A8C Claude/Katie Style Guide.md on first run."
        />
        <PlaceholderCard
          title="Learnings"
          description="Auto-populated rules from draft archival diffs. Each learning has Keep / Merge with-/ Remove buttons. Periodic AI-assisted dedup pass after every 10 archives (review-then-accept)."
        />
      </PageShell>
    </>
  );
}
