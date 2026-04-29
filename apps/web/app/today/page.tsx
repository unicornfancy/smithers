import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  FolderKanban,
  Inbox,
  PenLine,
} from "lucide-react";

import type { RealisticShapeOutput, TopThreeOutput } from "@smithers/agents";
import type { Ping, SourceResult } from "@smithers/mcp-client";

import { AppHeader } from "@/components/app-header";
import { DailyNoteSourceLink } from "@/components/daily-note-source-link";
import { EmptyState, VaultMissingNotice } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { PingsToAction } from "@/components/pings-to-action";
import { RealisticShapeCard } from "@/components/realistic-shape-card";
import { StallsCard } from "@/components/stalls-card";
import { TopThreeCard } from "@/components/top-three-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgentRuntimeStatus } from "@/lib/server/agents";
import {
  dateCacheKey,
  getCached,
} from "@/lib/server/llm-cache";
import { getMcpClient } from "@/lib/server/mcp";
import { detectStalls } from "@/lib/server/stalls";
import {
  applyTop3UserActions,
  buildTopThreeCandidates,
  type TopThreeCandidate,
} from "@/lib/server/top-three";
import {
  listDismissedIds,
  listEntityIdsWithAction,
} from "@/lib/server/user-actions";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "Today · Smithers",
};

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const todayIso = new Date().toISOString().slice(0, 10);

  const vault = await getVault();
  const status = vault.status();
  const dailyNoteAbsPath = vault.dailyNotePath(todayIso);
  const dailyNoteExistsToday = status.exists
    ? Boolean(await vault.readDailyNote(todayIso).catch(() => null))
    : false;

  // Pull all the high-level counts in parallel; degrade gracefully on missing vault.
  const [projects, drafts, followUps, dailyNotes] = status.exists
    ? await Promise.all([
        vault.listProjects().catch(() => []),
        vault.listDrafts().catch(() => []),
        vault
          .listFollowUps()
          .catch(() => ({ active: [], resolved: [] }) as never),
        vault.listDailyNotes().catch(() => []),
      ])
    : [
        [] as Awaited<ReturnType<typeof vault.listProjects>>,
        [] as Awaited<ReturnType<typeof vault.listDrafts>>,
        { active: [], resolved: [] } as Awaited<
          ReturnType<typeof vault.listFollowUps>
        >,
        [] as Awaited<ReturnType<typeof vault.listDailyNotes>>,
      ];

  const inProgressDrafts = drafts.filter((d) => d.state === "in-progress");
  const latestDailyNote = dailyNotes.at(-1);

  const mcp = await getMcpClient();
  const pingsResult = await mcp.contextA8C.listPings({ limit: 10 });
  const dismissedPingIds = await listDismissedIds("ping").catch(
    () => new Set<string>(),
  );
  const filteredPingsResult = filterPingsResult(
    pingsResult,
    dismissedPingIds,
  );
  const pings = filteredPingsResult.ok
    ? filteredPingsResult.data
    : (filteredPingsResult.cachedData ?? []);
  const agentStatus = await getAgentRuntimeStatus();
  const [pinnedTop3Ids, demotedTop3Ids] = await Promise.all([
    listEntityIdsWithAction("top3_candidate", "pin").catch(
      () => new Set<string>(),
    ),
    listEntityIdsWithAction("top3_candidate", "demote").catch(
      () => new Set<string>(),
    ),
  ]);
  const rawCandidates = status.exists
    ? await buildTopThreeCandidates({ vault, pings }).catch(() => [])
    : [];
  const topCandidates = applyTop3UserActions(
    rawCandidates,
    pinnedTop3Ids,
    demotedTop3Ids,
  );
  // Cached LLM picks from earlier today, if any. Only hand them to the
  // card if the API key is configured — otherwise the user can't
  // regenerate when something feels off.
  const cachedTop3 = agentStatus.configured
    ? await getCached<{
        output: TopThreeOutput;
        candidates: TopThreeCandidate[];
      }>("top-3", dateCacheKey("top-3")).catch(() => null)
    : null;
  const cachedShape = agentStatus.configured
    ? await getCached<{ output: RealisticShapeOutput }>(
        "realistic-shape",
        dateCacheKey("realistic-shape"),
      ).catch(() => null)
    : null;
  const stalls = status.exists
    ? await detectStalls({ vault }).catch(() => ({
        items: [],
        counts: {
          force_decide: 0,
          escalate: 0,
          nudge: 0,
          next_nudge_upcoming: 0,
        },
      }))
    : {
        items: [],
        counts: {
          force_decide: 0,
          escalate: 0,
          nudge: 0,
          next_nudge_upcoming: 0,
        },
      };

  return (
    <>
      <AppHeader
        title="Today"
        subtitle={today}
        actions={
          status.exists ? (
            <DailyNoteSourceLink
              path={dailyNoteAbsPath}
              exists={dailyNoteExistsToday}
            />
          ) : null
        }
      />
      <PageShell>
        {!status.exists ? (
          <VaultMissingNotice vaultPath={status.vault_path} />
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<FolderKanban className="size-4" />}
            label="Projects"
            value={projects.length}
            href="/projects"
          />
          <StatCard
            icon={<PenLine className="size-4" />}
            label="Drafts in flight"
            value={inProgressDrafts.length}
            href="/drafts"
          />
          <StatCard
            icon={<Inbox className="size-4" />}
            label="Follow-ups waiting"
            value={followUps.active.length}
            href="/follow-ups"
            tone={followUps.active.length > 5 ? "warn" : "neutral"}
          />
          <StatCard
            icon={<CalendarDays className="size-4" />}
            label="Daily notes"
            value={dailyNotes.length}
            secondary={
              latestDailyNote ? `latest ${latestDailyNote.date}` : undefined
            }
          />
        </div>

        {status.exists && followUps.active.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Inbox className="text-muted-foreground size-4" />
                Follow-ups waiting
                <span className="text-muted-foreground text-xs font-normal">
                  · {followUps.active.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col divide-y">
              {followUps.active.slice(0, 6).map((f) => (
                <div
                  key={f.follow_up_id}
                  className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-sm leading-snug">{f.task}</p>
                    <p className="text-muted-foreground text-xs">
                      {f.project}
                      {f.sent ? ` · sent ${f.sent}` : ""}
                      {f.follow_up_by ? ` · due ${f.follow_up_by}` : ""}
                    </p>
                  </div>
                  <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                    {f.status}
                  </span>
                </div>
              ))}
              {followUps.active.length > 6 ? (
                <Button variant="link" size="sm" asChild className="self-start">
                  <Link href="/follow-ups">
                    See all {followUps.active.length} waiting
                  </Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {status.exists && projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Add some markdown files under your vault's Projects/ folder, or run /setup to point Smithers at a different vault."
            action={
              <Button asChild size="sm">
                <Link href="/setup">Run setup wizard</Link>
              </Button>
            }
          />
        ) : null}

        <TopThreeCard
          initialCandidates={topCandidates}
          apiKeyConfigured={agentStatus.configured}
          pinnedIds={Array.from(pinnedTop3Ids)}
          cachedLlm={cachedTop3 ?? undefined}
        />

        <StallsCard
          summary={stalls}
          apiKeyConfigured={agentStatus.configured}
        />

        <PingsToAction result={filteredPingsResult} />

        <RealisticShapeCard
          apiKeyConfigured={agentStatus.configured}
          cached={cachedShape?.output}
        />
      </PageShell>
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  secondary,
  href,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  secondary?: string;
  href?: string;
  tone?: "neutral" | "warn" | "ok";
}) {
  const body = (
    <Card
      className={
        tone === "warn"
          ? "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20"
          : tone === "ok"
            ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
            : ""
      }
    >
      <CardHeader>
        <CardTitle className="text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-foreground text-3xl font-semibold tabular-nums">
            {value}
          </span>
          {tone === "warn" ? (
            <CircleAlert className="size-4 text-amber-600 dark:text-amber-400" />
          ) : tone === "ok" ? (
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : null}
        </div>
        {secondary ? (
          <p className="text-muted-foreground mt-1 text-xs">{secondary}</p>
        ) : null}
      </CardContent>
    </Card>
  );

  if (!href) return body;
  return (
    <Link href={href} className="block transition-opacity hover:opacity-90">
      {body}
    </Link>
  );
}

/**
 * Strip dismissed pings out of the SourceResult while preserving its
 * branch shape (ok / not-ok with cachedData). Component still gets to
 * render freshness + degraded states correctly.
 */
function filterPingsResult(
  result: SourceResult<Ping[]>,
  dismissed: Set<string>,
): SourceResult<Ping[]> {
  if (dismissed.size === 0) return result;
  if (result.ok) {
    return {
      ...result,
      data: result.data.filter((p) => !dismissed.has(p.id)),
    };
  }
  return {
    ...result,
    cachedData: result.cachedData?.filter((p) => !dismissed.has(p.id)),
  };
}
