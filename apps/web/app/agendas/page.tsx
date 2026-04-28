import { AppHeader } from "@/components/app-header";
import { PageShell, PlaceholderCard } from "@/components/page-shell";

export const metadata = {
  title: "Agendas · Smithers",
};

export default function AgendasPage() {
  return (
    <>
      <AppHeader
        title="Agendas"
        subtitle="Per-project running agendas with post-call archival"
      />
      <PageShell>
        <PlaceholderCard
          title="Agendas index"
          description="One agenda file per project with an Open Items list and dated archived sections. After each call, items move to that meeting's section automatically."
        />
      </PageShell>
    </>
  );
}
