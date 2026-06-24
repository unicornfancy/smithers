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
import { SectionList, type SectionDef } from "@/components/section-list";
import { HighlightBanner } from "@/components/today/highlight-banner";
import { DeadlinesCard } from "@/components/today/deadlines-card";
import { HotPings } from "@/components/today/hot-pings";
import { MentionsCard } from "@/components/today/mentions-card";
import {
  MovingFastStrip,
  type MovingFastEntry,
} from "@/components/today/moving-fast-strip";
import { WaitingOnYouCard } from "@/components/today/waiting-on-you-card";
import { TopThreeCard } from "@/components/top-three-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgentRuntimeStatus } from "@/lib/server/agents";
import { loadConfig } from "@/lib/server/config";
import {
  dateCacheKey,
  getCached,
} from "@/lib/server/llm-cache";
import { getMcpClient } from "@/lib/server/mcp";
import {
  getActionedStatuses,
  getMostRecentCheckedAt,
} from "@/lib/server/ping-actioned";
import { loadPartnerContactsBySlug } from "@/lib/server/partner-contacts";
import { recordingMatchesProject } from "@/lib/server/recording-match";
import { getTranscriptionAdapter } from "@/lib/server/transcription";
import { detectStalls } from "@/lib/server/stalls";
import { listUpcomingDeadlines } from "@/lib/server/today-deadlines";
import { filterMentions } from "@/lib/server/today-mentions";
import { listWaitingOnYouThreads } from "@/lib/server/today-waiting";
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
import { isoWeekId } from "@/lib/server/weekly-facts";
import {
  listDismissedIds,
  listEntityIdsWithAction,
  localMidnight,
} from "@/lib/server/user-actions";
import { requireConfiguredVault } from "@/lib/server/require-setup";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "Today · Smithers",
};

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  await requireConfiguredVault();
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
  const cfg = await loadConfig();

  const githubRepos = projects
    .map((p) => p.github_repo)
    .filter((r): r is string => Boolean(r));

  const githubHandle = cfg.identity.github_handle?.trim() ?? "";

  const [pingsResult, githubPings, recordingsResult] = await Promise.all([
    mcp.contextA8C.listPings({ limit: 10 }),
    githubHandle
      ? mcp.contextA8C
          .listGithubMentionPings(githubRepos, githubHandle)
          .catch(() => [] as Ping[])
      : Promise.resolve([] as Ping[]),
    (await getTranscriptionAdapter()).listRecordings({ limit: 20 }),
  ]);

  const recentRecordings = recordingsResult.ok
    ? recordingsResult.data
    : (recordingsResult.cachedData ?? []);
  const partnerContactsBySlug = await loadPartnerContactsBySlug(
    vault,
    projects,
  );
  const recentCallRows: RecentCallRow[] = recentRecordings.map((rec) => ({
    recording: rec,
    matchedProjects: projects
      .filter((p) => {
        if (p.kind !== "partner" && p.kind !== "team") return false;
        const signals = partnerContactsBySlug.get(p.slug);
        return recordingMatchesProject(rec, {
          ...p,
          partner_contact_emails: signals?.emails,
          partner_contact_names: signals?.names,
        });
      })
      .map((p) => ({ slug: p.slug, name: p.name })),
  }));
  const unmatchedRecentCalls = recentCallRows.filter(
    (r) => r.matchedProjects.length === 0,
  ).length;

  // Linear inbox pings carry a Linear UUID for the issue's project
  // (when there is one), but no knowledge of which vault project that
  // maps to. Resolve here so the link in PingsToAction points at the
  // Smithers workbench when one exists; otherwise the project name
  // stays as a non-link label so the user still sees context.
  const linearIdToVaultProject = new Map<string, { slug: string; name: string }>();
  for (const p of projects) {
    if (p.linear_project_id) {
      linearIdToVaultProject.set(p.linear_project_id, { slug: p.slug, name: p.name });
    }
  }
  const resolveLinearProjectMatch = (ping: Ping): Ping => {
    const m = ping.project_match;
    if (!m || m.matched_by !== "linear_project") return ping;
    if (!m.linear_project_id) return ping;
    const vault = linearIdToVaultProject.get(m.linear_project_id);
    if (!vault) return ping;
    return {
      ...ping,
      project_match: {
        ...m,
        project_slug: vault.slug,
        display_label: vault.name,
        in_vault: true,
      },
    };
  };

  // Merge GitHub mention pings into the main SourceResult so the
  // existing PingsToAction component and filterPingsResult helper
  // handle them uniformly.
  const mergedPingsResult: typeof pingsResult = pingsResult.ok
    ? {
        ...pingsResult,
        data: [...pingsResult.data.map(resolveLinearProjectMatch), ...githubPings],
      }
    : {
        ...pingsResult,
        cachedData: [
          ...(pingsResult.cachedData ?? []).map(resolveLinearProjectMatch),
          ...githubPings,
        ],
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

  const highlightBanner = await computeHighlightBanner({ vault });

  // Top-of-/today priority signals — Waiting on you / Mentions /
  // Deadlines. Each runs independently so a slow Linear lookup
  // doesn't gate a fast Zendesk pass.
  const deadlinesWindowDays = cfg.today?.deadlines_window_days ?? 14;
  const mentions = filterMentions(pings);
  const [waitingThreads, upcomingDeadlines] = await Promise.all([
    status.exists
      ? listWaitingOnYouThreads({ projects, limit: 12 }).catch(() => [])
      : Promise.resolve([]),
    status.exists
      ? listUpcomingDeadlines({
          windowDays: deadlinesWindowDays,
          projects,
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

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

        {status.exists && projects.length > 0 ? (
          <SectionList
            scope="today"
            sections={buildTodaySections({
              hotPings,
              movingFastEntries,
              pingsTotal: pings.length,
              followUps,
              topCandidates,
              agentConfigured: agentStatus.configured,
              pinnedTop3Ids,
              cachedTop3,
              stalls,
              filteredPingsResult,
              actionedIds,
              actionedCheckedAt,
              recentCallRows,
              unmatchedRecentCalls,
              projectsCount: projects.length,
              inProgressDraftsCount: inProgressDrafts.length,
              dailyNotesCount: dailyNotes.length,
              latestDailyNoteDate: latestDailyNote?.date,
              cachedShape,
              highlightBanner,
              waitingThreads,
              mentions,
              upcomingDeadlines,
              deadlinesWindowDays,
            })}
          />
        ) : null}
      </PageShell>
    </>
  );
}


/**
 * Compose the section list /today renders, in default order. Each
 * section gets a stable id used by `useLayoutPrefs` to track user
 * customizations. Pre-built React nodes (server-rendered) get handed
 * to the client `SectionList` which orders + shows/hides them per
 * the user's saved layout.
 */
function buildTodaySections(args: {
  hotPings: Ping[];
  movingFastEntries: MovingFastEntry[];
  pingsTotal: number;
  followUps: { active: Array<{ follow_up_id: string; task: string; project: string; sent?: string; follow_up_by?: string; status: string }> };
  topCandidates: TopThreeCandidate[];
  agentConfigured: boolean;
  pinnedTop3Ids: Set<string>;
  cachedTop3: { output: TopThreeOutput; candidates: TopThreeCandidate[] } | null;
  stalls: Awaited<ReturnType<typeof detectStalls>>;
  filteredPingsResult: SourceResult<Ping[]>;
  actionedIds: Set<string>;
  actionedCheckedAt: string | null;
  recentCallRows: RecentCallRow[];
  unmatchedRecentCalls: number;
  projectsCount: number;
  inProgressDraftsCount: number;
  dailyNotesCount: number;
  latestDailyNoteDate: string | undefined;
  cachedShape: { output: RealisticShapeOutput } | null;
  highlightBanner: { isoWeek: string; windowLabel: string } | null;
  waitingThreads: Awaited<ReturnType<typeof listWaitingOnYouThreads>>;
  mentions: ReturnType<typeof filterMentions>;
  upcomingDeadlines: Awaited<ReturnType<typeof listUpcomingDeadlines>>;
  deadlinesWindowDays: number;
}): SectionDef[] {
  const sections: SectionDef[] = [];

  if (args.highlightBanner) {
    sections.push({
      id: "highlight-banner",
      title: "Weekly highlight prompt",
      node: (
        <HighlightBanner
          isoWeek={args.highlightBanner.isoWeek}
          windowLabel={args.highlightBanner.windowLabel}
        />
      ),
    });
  }

  if (args.waitingThreads.length > 0) {
    sections.push({
      id: "waiting-on-you",
      title: "Waiting on you",
      node: <WaitingOnYouCard rows={args.waitingThreads} />,
    });
  }

  if (args.mentions.length > 0) {
    sections.push({
      id: "mentions",
      title: "Mentions",
      node: <MentionsCard rows={args.mentions} />,
    });
  }

  if (args.upcomingDeadlines.length > 0) {
    sections.push({
      id: "deadlines",
      title: "Deadlines",
      node: (
        <DeadlinesCard
          rows={args.upcomingDeadlines}
          windowDays={args.deadlinesWindowDays}
        />
      ),
    });
  }

  if (args.hotPings.length > 0) {
    sections.push({
      id: "hot-pings",
      title: "Hot today",
      node: <HotPings pings={args.hotPings} totalCount={args.pingsTotal} />,
    });
  }

  if (args.movingFastEntries.length > 0) {
    sections.push({
      id: "moving-fast",
      title: "Moving fast",
      node: <MovingFastStrip entries={args.movingFastEntries} windowDays={7} />,
    });
  }

  if (args.followUps.active.length > 0) {
    sections.push({
      id: "follow-ups-waiting",
      title: "Follow-ups waiting",
      node: (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Inbox className="text-muted-foreground size-4" />
              Follow-ups waiting
              <span className="text-muted-foreground text-xs font-normal">
                · {args.followUps.active.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {args.followUps.active.slice(0, 6).map((f) => (
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
            {args.followUps.active.length > 6 ? (
              <Button variant="link" size="sm" asChild className="self-start">
                <Link href="/follow-ups">
                  See all {args.followUps.active.length} waiting
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ),
    });
  }

  sections.push({
    id: "top-three",
    title: "Top 3 for today",
    node: (
      <TopThreeCard
        initialCandidates={args.topCandidates}
        apiKeyConfigured={args.agentConfigured}
        pinnedIds={Array.from(args.pinnedTop3Ids)}
        cachedLlm={args.cachedTop3 ?? undefined}
      />
    ),
  });

  sections.push({
    id: "stalls",
    title: "Stalls",
    node: (
      <StallsCard summary={args.stalls} apiKeyConfigured={args.agentConfigured} />
    ),
  });

  sections.push({
    id: "pings-to-action",
    title: "Pings to action",
    node: (
      <PingsToAction
        result={args.filteredPingsResult}
        actionedIds={Array.from(args.actionedIds)}
        actionedCheckedAt={args.actionedCheckedAt}
      />
    ),
  });

  sections.push({
    id: "recent-calls",
    title: "Recent calls",
    node: (
      <RecentCallsCard
        rows={args.recentCallRows}
        unmatchedCount={args.unmatchedRecentCalls}
      />
    ),
  });

  sections.push({
    id: "counts-summary",
    title: "Counts & summary",
    defaultHidden: true,
    node: (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<FolderKanban className="size-4" />}
            label="Projects"
            value={args.projectsCount}
            href="/projects"
          />
          <StatCard
            icon={<PenLine className="size-4" />}
            label="Drafts in flight"
            value={args.inProgressDraftsCount}
            href="/drafts"
          />
          <StatCard
            icon={<Inbox className="size-4" />}
            label="Follow-ups waiting"
            value={args.followUps.active.length}
            href="/follow-ups"
            tone={args.followUps.active.length > 5 ? "warn" : "neutral"}
          />
          <StatCard
            icon={<CalendarDays className="size-4" />}
            label="Daily notes"
            value={args.dailyNotesCount}
            secondary={
              args.latestDailyNoteDate ? `latest ${args.latestDailyNoteDate}` : undefined
            }
          />
        </div>
        <RealisticShapeCard
          apiKeyConfigured={args.agentConfigured}
          cached={args.cachedShape?.output}
        />
      </div>
    ),
  });

  return sections;
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
 * Decide whether to show the Friday-PM / Monday-AM nudge on /today.
 * Returns null on quiet days, when a highlight already exists for the
 * current iso-week, or when the vault helper isn't reachable. The
 * banner itself handles per-week dismissal in localStorage.
 */
async function computeHighlightBanner(args: {
  vault: Awaited<ReturnType<typeof getVault>>;
}): Promise<{ isoWeek: string; windowLabel: string } | null> {
  const now = new Date();
  const day = now.getDay(); // 0 Sun ... 5 Fri ... 6 Sat
  const hour = now.getHours();
  let windowLabel: string | null = null;
  if (day === 5 && hour >= 14) windowLabel = "Friday afternoon";
  else if (day === 1 && hour < 14) windowLabel = "Monday morning";
  if (!windowLabel) return null;
  const isoWeek = isoWeekId(now);
  try {
    const existing = await args.vault.readWeeklyHighlight(isoWeek);
    if (existing && existing.body.trim().length > 0) return null;
  } catch {
    return null;
  }
  return { isoWeek, windowLabel };
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
