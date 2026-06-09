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
  // The Monday weekly-update debriefs the week that *just ended* — so
  // the default draft button targets the previous ISO week, not the
  // calendar week you're currently in. If you draft on Tuesday June 9
  // (W24), you're recapping W23 (June 1-7) and planning W24 forward.
  const lastWeekMonday = new Date(today);
  lastWeekMonday.setUTCDate(today.getUTCDate() - 7);
  const debriefWeekId = isoWeekId(lastWeekMonday);
  const { week: debriefWeekNumber } = isoWeekParts(lastWeekMonday);
  const currentWeekId = isoWeekId(today);
  const { week: currentWeekNumber } = isoWeekParts(today);
  const hasDebriefWeek = past.some((p) => p.iso_week === debriefWeekId);
  const hasCurrentWeek = past.some((p) => p.iso_week === currentWeekId);

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
              Last week — Week {debriefWeekNumber}
              {hasDebriefWeek ? (
                <span className="text-muted-foreground text-xs font-normal">
                  · saved draft exists
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-muted-foreground mb-2 text-xs">
              Debriefs week {debriefWeekNumber}&apos;s activity and plans the
              week ahead. This is the typical Monday-morning draft.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" className="gap-1.5">
                <Link href={`/weekly-updates/${debriefWeekId}`}>
                  {hasDebriefWeek ? "Open last week's draft" : "Draft last week"}
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
                <Link href={`/weekly-updates/${currentWeekId}`}>
                  {hasCurrentWeek
                    ? `Open this week's draft (Week ${currentWeekNumber})`
                    : `Draft this week (Week ${currentWeekNumber})`}
                </Link>
              </Button>
            </div>
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
