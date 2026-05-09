import { ArrowRight, FileText, Sparkles } from "lucide-react";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";
import { getVault } from "@/lib/server/vault";
import { isoWeekId, isoWeekParts } from "@/lib/server/weekly-facts";

export const metadata = {
  title: "Weekly Updates · Smithers",
};

export const dynamic = "force-dynamic";

export default async function WeeklyUpdatesPage() {
  const vault = await getVault();
  const past = await vault.listWeeklyUpdates().catch(() => []);

  const today = new Date();
  const thisWeekId = isoWeekId(today);
  const { week: thisWeekNumber } = isoWeekParts(today);
  const hasThisWeek = past.some((p) => p.iso_week === thisWeekId);

  // Display newest first.
  const sorted = [...past].sort((a, b) => b.iso_week.localeCompare(a.iso_week));

  return (
    <>
      <AppHeader
        title="Weekly Updates"
        subtitle="Per-week drafts of your Monday team-P2 update"
      />
      <PageShell>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="text-muted-foreground size-4" />
              This week — Week {thisWeekNumber}
              {hasThisWeek ? (
                <span className="text-muted-foreground text-xs font-normal">
                  · saved draft exists
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Button asChild size="sm" className="gap-1.5">
              <Link href={`/weekly-updates/${thisWeekId}`}>
                {hasThisWeek ? "Open this week's draft" : "Draft this week"}
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="text-muted-foreground size-4" />
              Past updates
              <span className="text-muted-foreground text-xs font-normal">
                · {sorted.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sorted.length === 0 ? (
              <p className="text-muted-foreground text-sm italic">
                No saved updates yet.
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {sorted.map((u) => (
                  <li
                    key={u.iso_week}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <Link
                      href={`/weekly-updates/${u.iso_week}`}
                      className="hover:text-foreground text-sm"
                    >
                      Week {u.week} · {u.iso_week}
                    </Link>
                    <span className="text-muted-foreground/70 text-[11px] tabular-nums">
                      {u.relative_path}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </PageShell>
    </>
  );
}
