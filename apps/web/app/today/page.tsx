import { AppHeader } from "@/components/app-header";
import { PageShell, PlaceholderCard } from "@/components/page-shell";

export const metadata = {
  title: "Today · Smithers",
};

export default function TodayPage() {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <AppHeader title="Today" subtitle={today} />
      <PageShell>
        <PlaceholderCard
          title="Welcome to Smithers"
          description="This is the Today dashboard. Once configured, it will surface your Top 3, pings to action, follow-ups due, stalls, calendar, and a realistic shape of the day — derived from your project workbenches."
          todo={[
            "Run the /setup wizard to point Smithers at your vault and live-data MCPs",
            "Add or import projects (partner / team / personal)",
            "Trigger your first morning briefing",
          ]}
        />
        <PlaceholderCard
          title="Top 3 for today"
          description="Auto-suggested from rules-based scoring + LLM picks. Pin / demote / regenerate from this card."
        />
        <PlaceholderCard
          title="Pings to Action"
          description="Inbound messages with full project context pre-assembled next to them (Phase 6)."
        />
        <PlaceholderCard
          title="Follow-ups due · Stalls & Closures · Calendar · Realistic Shape"
          description="The rest of the dashboard sections will materialize as the underlying packages come online."
        />
      </PageShell>
    </>
  );
}
