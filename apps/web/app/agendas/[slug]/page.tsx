import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { AgendaEditor } from "@/components/agenda-editor";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "Agenda · Smithers",
};

export const dynamic = "force-dynamic";

export default async function AgendaEditorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const vault = await getVault();
  const list = await vault.listAgendas().catch(() => []);
  const ref = list.find((a) => slugifyFilename(a.filename) === slug);
  if (!ref) notFound();
  const agenda = await vault.readAgenda(ref.filename).catch(() => null);
  if (!agenda) notFound();

  const openCount = agenda.open_items.filter((i) => !i.checked).length;
  const checkedCount = agenda.open_items.length - openCount;

  return (
    <>
      <AppHeader
        title={agenda.title}
        subtitle={`${openCount} open · ${checkedCount} checked · ${agenda.archived.length} archived section${agenda.archived.length === 1 ? "" : "s"}`}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link href="/agendas">
              <ChevronLeft className="mr-1 size-3.5" />
              All agendas
            </Link>
          </Button>
        }
      />
      <PageShell>
        <AgendaEditor agenda={agenda} />
      </PageShell>
    </>
  );
}

function slugifyFilename(filename: string): string {
  return filename
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
