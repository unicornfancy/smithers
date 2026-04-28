import { AppHeader } from "@/components/app-header";
import { PageShell, PlaceholderCard } from "@/components/page-shell";

export const metadata = {
  title: "Follow-ups · Smithers",
};

export default function FollowUpsPage() {
  return (
    <>
      <AppHeader
        title="Follow-ups"
        subtitle="Active and resolved follow-ups across all projects"
      />
      <PageShell>
        <PlaceholderCard
          title="Active follow-ups"
          description="Editable interval defaults, due-soon highlighting, and AI-suggested nudges."
        />
        <PlaceholderCard
          title="Resolved follow-ups"
          description="Auto-resolution from inbound activity surfaces here for review."
        />
      </PageShell>
    </>
  );
}
