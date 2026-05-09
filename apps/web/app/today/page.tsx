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
import type { Project } from "@smithers/vault";

import { AppHeader } from "@/components/app-header";
import { DailyNoteSourceLink } from "@/components/daily-note-source-link";
import { EmptyState, VaultMissingNotice } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { PingsToAction } from "@/components/pings-to-action";
import { RealisticShapeCard } from "@/components/realistic-shape-card";
import {
  RecentCallsCard,
  type RecentCallRow,
} from "@/components/recent-calls-card";
import { StallsCard } from "@/components/stalls-card";
import { BackgroundTier } from "@/components/today/background-tier";
import { HotPings } from "@/components/today/hot-pings";
import {
  MovingFastStrip,
  type MovingFastEntry,
} from "@/components/today/moving-fast-strip";
import { TopThreeCard } from "@/components/top-three-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgentRuntimeStatus } from "@/lib/server/agents";
import {
  dateCacheKey,
  getCached,
} from "@/lib/server/llm-cache";
import { getMcpClient } from "@/lib/server/mcp";
import {
  getActionedStatuses,
  getMostRecentCheckedAt,
} from "@/lib/server/ping-actioned";
import { recordingMatchesProject } from "@/lib/server/recording-match";
import { detectStalls } from "@/lib/server/stalls";
import {
  computePingImportanceScore,
  extractPartnerContacts,
  getProjectActivityCounts,
  getProjectPriority,
  type PingImportanceContext,
} from "@/lib/server/today-signals";
import {
  applyTop3UserActions,
  buildTopThreeCandidates,
  type TopThreeCandidate,
} from "@/lib/server/top-three";
import {
  listDismissedIds,
  listEntityIdsWithAction,
  localMidnight,
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

  const githubRepos = projects
    .map((p) => p.github_repo)
    .filter((r): r is string => Boolean(r));

  const [pingsResult, githubPings, recordingsResult] = await Promise.all([
    mcp.contextA8C.listPings({ limit: 10 }),
    mcp.contextA8C.listGithubMentionPings(githubRepos, "unicornfancy").catch(
      () => [] as Ping[],
    ),
    mcp.fathom.listRecordings({ limit: 20 }),
  ]);

  const recentRecordings = recordingsResult.ok
    ? recordingsResult.data
    : (recordingsResult.cachedData ?? []);
  const recentCallRows: RecentCallRow[] = recentRecordings.map((rec) => ({
    recording: rec,
    matchedProjects: projects
      .filter(
        (p) =>
          (p.kind === "partner" || p.kind === "team") &&
          recordingMatchesProject(rec, p),
      )
      .map((p) => ({ slug: p.slug, name: p.name })),
  }));
  const unmatchedRecentCalls = recentCallRows.filter(
    (r) => r.matchedProjects.length === 0,
  ).length;

  // Merge GitHub mention pings into the main SourceResult so the
  // existing PingsToAction component and filterPingsResult helper
  // handle them uniformly.
  const mergedPingsResult: typeof pingsResult = pingsResult.ok
    ? { ...pingsResult, data: [...pingsResult.data, ...githubPings] }
    : {
        ...pingsResult,
        cachedData: [...(pingsResult.cachedData ?? []), ...githubPings],
      };

  const dismissedPingIds = await listDismissedIds("ping").catch(
    () => new Set<string>(),
  );
  const filteredPingsResult = filterPingsResult(
    mergedPingsResult,
    dismissedPingIds,
  );
  const pings = filteredPingsResult.ok
    ? filteredPingsResult.data
    : (filteredPingsResult.cachedData ?? []);
  const agentStatus = await getAgentRuntimeStatus();
  // Pin/demote are today-scoped per the design — older rows stay in
  // user_actions for the audit trail but don't affect Top 3 ranking.
  const since = localMidnight();
  const [pinnedTop3Ids, demotedTop3Ids] = await Promise.all([
    listEntityIdsWithAction("top3_candidate", "pin", since).catch(
      () => new Set<string>(),
    ),
    listEntityIdsWithAction("top3_candidate", "demote", since).catch(
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

  // T1 wiring: importance score + 7-day velocity. Each helper degrades
  // to a no-op (empty array) on failure so /today still renders.
  const { hotPings, movingFastEntries } = await buildHotAndMovingFast({
    pings,
    projects,
  });

  // Cached "did Katie already reply" verdicts. Populated by an explicit
  // Refresh action — see refreshPingsActionedAction. Pings without a
  // cache entry render normally (treated as not-yet-checked).
  const actionedMap = await getActionedStatuses(pings.map((p) => p.id)).catch(
    () => new Map(),
  );
  const actionedIds = new Set<string>();
  for (const [id, row] of actionedMap) {
    if (row.actioned) actionedIds.add(id);
  }
  const actionedCheckedAt = await getMostRecentCheckedAt().catch(() => null);

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

        {/* HOT TIER — top of page, prominent. Only renders when there's */}
        {/* a real signal (high-priority project, contact match, or LLM pick). */}
        <HotPings pings={hotPings} totalCount={pings.length} />
        <MovingFastStrip entries={movingFastEntries} windowDays={7} />

        {/* ACTIVE TIER — current cards, full density. */}
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

        <PingsToAction
          result={filteredPingsResult}
          actionedIds={Array.from(actionedIds)}
          actionedCheckedAt={actionedCheckedAt}
        />

        <RecentCallsCard
          rows={recentCallRows}
          unmatchedCount={unmatchedRecentCalls}
        />

        {/* BACKGROUND TIER — collapsed by default; localStorage-persisted. */}
        <BackgroundTier label="Counts & summary">
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

          <RealisticShapeCard
            apiKeyConfigured={agentStatus.configured}
            cached={cachedShape?.output}
          />
        </BackgroundTier>
      </PageShell>
    </>
  );
}


const HOT_PINGS_LIMIT = 5;
const HOT_PINGS_MIN_SCORE = 20;
const MOVING_FAST_LIMIT = 5;

/**
 * Build the HOT-tier inputs for /today: top pings by importance score
 * and the velocity strip's top partner projects by 7-day activity.
 *
 * Sequential per-project lookups are fine — we only have ~10 partner
 * projects in practice. Failures collapse to empty lists rather than
 * throwing, since /today is a read-only dashboard.
 */
async function buildHotAndMovingFast(args: {
  pings: Ping[];
  projects: Project[];
}): Promise<{
  hotPings: Ping[];
  movingFastEntries: MovingFastEntry[];
}> {
  const { projects } = args;
  const referencedSlugs = new Set<string>();
  for (const p of args.pings) {
    const slug = p.project_match?.project_slug;
    if (slug) referencedSlugs.add(slug);
  }

  const projectPriorities = new Map<
    string,
    "high" | "medium" | "low" | null
  >();
  const projectContacts = new Map<string, Set<string>>();
  for (const slug of referencedSlugs) {
    const project = projects.find((p) => p.slug === slug);
    if (!project) continue;
    projectPriorities.set(slug, await getProjectPriority(slug));
    const partnerSlug = project.hive_mind_partner_slug ?? project.partner;
    if (partnerSlug) {
      projectContacts.set(slug, await extractPartnerContacts(partnerSlug));
    } else {
      projectContacts.set(slug, new Set());
    }
  }

  const ctx: PingImportanceContext = {
    projectPriorities,
    projectContacts,
  };

  const hotPings = [...args.pings]
    .map((p) => ({ ping: p, score: computePingImportanceScore(p, ctx) }))
    .filter((x) => x.score >= HOT_PINGS_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, HOT_PINGS_LIMIT)
    .map((x) => x.ping);

  const partnerProjects = projects.filter(
    (p) => p.kind === "partner" || p.kind === "team",
  );
  const counts = await getProjectActivityCounts(
    partnerProjects.map((p) => p.slug),
    { days: 7 },
  );
  const movingFastEntries: MovingFastEntry[] = partnerProjects
    .map((p) => ({ slug: p.slug, name: p.name, count: counts[p.slug] ?? 0 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, MOVING_FAST_LIMIT);

  return { hotPings, movingFastEntries };
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
