import Link from "next/link";
import { ListTodo } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "Agendas · Smithers",
};

export const dynamic = "force-dynamic";

export default async function AgendasPage() {
  const vault = await getVault();
  const refs = await vault.listAgendas().catch(() => []);

  // Read each agenda so we can show item counts on the index. ~few dozen
  // small files; do them in parallel.
  const agendas = await Promise.all(
    refs.map(async (ref) => {
      const a = await vault.readAgenda(ref.filename).catch(() => null);
      return { ref, agenda: a };
    }),
  );

  return (
    <>
      <AppHeader
        title="Agendas"
        subtitle={`${refs.length} agenda${refs.length === 1 ? "" : "s"} — running list of items to raise on the next call with each partner`}
      />
      <PageShell>
        {refs.length === 0 ? (
          <EmptyState
            title="No agendas yet"
            description="Create a markdown file under Agendas/ in your vault with a '## Open Items' section, or use any project's workbench to seed one."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {agendas.map(({ ref, agenda }) => {
              const slug = slugifyFilename(ref.filename);
              const openCount =
                agenda?.open_items.filter((i) => !i.checked).length ?? 0;
              const checkedCount =
                agenda?.open_items.filter((i) => i.checked).length ?? 0;
              const archivedCount = agenda?.archived.length ?? 0;
              return (
                <Link
                  key={ref.filename}
                  href={`/agendas/${slug}`}
                  className="block"
                >
                  <Card className="hover:bg-accent/30 transition-colors">
                    <CardContent className="space-y-1 py-3">
                      <div className="flex items-baseline gap-2">
                        <ListTodo className="text-muted-foreground size-4 shrink-0" />
                        <span className="text-sm font-medium">
                          {agenda?.title ?? ref.filename.replace(/\.md$/i, "")}
                        </span>
                      </div>
                      <div className="text-muted-foreground flex gap-3 pl-6 text-[11px]">
                        <span>{openCount} open</span>
                        {checkedCount > 0 ? (
                          <span>{checkedCount} checked</span>
                        ) : null}
                        {archivedCount > 0 ? (
                          <span>
                            {archivedCount} archived section
                            {archivedCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
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
