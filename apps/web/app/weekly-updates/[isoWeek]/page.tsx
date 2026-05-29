import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { WeeklyUpdateEditor } from "@/components/weekly-update-editor";
import { getAgentRuntimeStatus } from "@/lib/server/agents";
import { detectTeamWeeklyPost } from "@/lib/server/team-weekly-post";
import { getVault } from "@/lib/server/vault";
import {
  isoWeekParts,
  isoWeekToMonday,
} from "@/lib/server/weekly-facts";

export const dynamic = "force-dynamic";

interface Params {
  isoWeek: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { isoWeek } = await params;
  return { title: `${isoWeek} · Weekly Updates` };
}

export default async function WeeklyUpdateEditorPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { isoWeek } = await params;
  const monday = isoWeekToMonday(isoWeek);
  if (!monday) notFound();

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const weekStart = monday.toISOString().slice(0, 10);
  const weekEnd = sunday.toISOString().slice(0, 10);
  const { week } = isoWeekParts(monday);

  const vault = await getVault();
  const existing = await vault.readWeeklyUpdate(isoWeek).catch(() => null);
  const teamPost = await detectTeamWeeklyPost(week);
  const agentStatus = await getAgentRuntimeStatus();

  return (
    <>
      <AppHeader
        title={`Weekly Update — Week ${week}`}
        subtitle={`${weekStart} → ${weekEnd}`}
        actions={
          <Button variant="ghost" size="sm" asChild className="gap-1.5">
            <Link href="/weekly-updates">
              <ArrowLeft className="size-3.5" />
              All weeks
            </Link>
          </Button>
        }
      />
      <PageShell>
        <WeeklyUpdateEditor
          isoWeek={isoWeek}
          weekStart={weekStart}
          weekEnd={weekEnd}
          teamPost={teamPost}
          initialBody={existing?.body ?? ""}
          initialOriginalBody={existing?.frontmatter.original_body ?? null}
          apiKeyConfigured={agentStatus.configured}
        />
      </PageShell>
    </>
  );
}
