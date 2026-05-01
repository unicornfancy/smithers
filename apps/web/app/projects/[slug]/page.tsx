import { notFound } from "next/navigation";

import {
  filterFollowUpsForProject,
  parseProjectTasks,
  splitTasks,
} from "@smithers/vault";

import { LiveActivityFeed } from "@/components/live-activity-feed";
import { NeedsDecisionPanel } from "@/components/needs-decision-panel";
import { ZendeskThreadsPanel } from "@/components/zendesk-threads-panel";
import { PageShell } from "@/components/page-shell";
import { WorkbenchHeader } from "@/components/workbench-header";
import {
  CallNotesPanel,
  DraftsForProjectPanel,
  ForYouTodayPanel,
  MilestonesPanel,
  OpenItemsPanel,
  PartnerInfoPanel,
  PersonalNotesPanel,
  ProjectBriefPanel,
} from "@/components/workbench-panels";
import { getAgentRuntimeStatus } from "@/lib/server/agents";
import { getMcpClient } from "@/lib/server/mcp";
import { detectStallsForProject } from "@/lib/server/stalls";
import { getVault } from "@/lib/server/vault";

interface Params {
  slug: string;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const vault = await getVault();
  const project = vault.status().exists
    ? await vault.readProject(slug).catch(() => null)
    : null;
  return {
    title: project ? `${project.name} · Smithers` : "Project · Smithers",
  };
}

export default async function ProjectWorkbenchPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const vault = await getVault();

  if (!vault.status().exists) {
    notFound();
  }

  const detail = await vault.readProjectDetail(slug);
  if (!detail) {
    notFound();
  }

  // Pull project-scoped data in parallel.
  const mcp = await getMcpClient();
  const [
    allDrafts,
    allFollowUps,
    activityResult,
    partnerResult,
    recordingsResult,
    stalls,
    agentStatus,
  ] = await Promise.all([
      vault.listDrafts().catch(() => []),
      vault
        .listFollowUps()
        .catch(() => ({ active: [], resolved: [] }) as never),
      mcp.contextA8C.listProjectActivity({
        project_slug: detail.slug,
        project_name: detail.name,
        limit: 20,
        refs: {
          github_repo: detail.github_repo,
          linear_project_id: detail.linear_project_id,
          linear_project_slug: detail.linear_project_slug,
          zendesk_tickets: detail.zendesk_tickets,
          p2_url: detail.p2_url,
          primary_slack_channel: detail.primary_slack_channel,
          team_slack_channel: detail.team_slack_channel,
          partner: detail.partner,
        },
      }),
      detail.partner
        ? mcp.hiveMind.getPartner({ partner_slug: detail.partner })
        : Promise.resolve(null),
      mcp.fathom.listRecordings({ limit: 50 }),
      detectStallsForProject(vault, detail.slug, detail.name).catch(() => ({
        items: [],
        counts: {
          force_decide: 0,
          escalate: 0,
          nudge: 0,
          next_nudge_upcoming: 0,
        },
      })),
      getAgentRuntimeStatus(),
    ]);

  const partnerProfile =
    partnerResult && partnerResult.ok
      ? partnerResult.data
      : (partnerResult?.cachedData ?? null);

  // Per-ticket summaries for the threads panel. One MCP call per
  // configured ticket — fan out in parallel, drop any that resolve to
  // null (parse failures or already-deleted tickets).
  const zendeskTicketRefs = detail.zendesk_tickets ?? [];
  const zendeskTickets =
    zendeskTicketRefs.length === 0
      ? []
      : (
          await Promise.all(
            zendeskTicketRefs.map((ref) =>
              mcp.contextA8C.fetchZendeskTicketSummary(ref).catch(() => null),
            ),
          )
        ).filter((t): t is NonNullable<typeof t> => t !== null);

  // Eager-fetch recent comments only for *active* tickets — closed
  // ones go into a folded disclosure that the user usually won't open,
  // so paying for the round-trip up front is wasteful. The panel
  // gracefully shows an empty disclosure when comments aren't passed.
  const activeTicketIds = new Set(
    zendeskTickets
      .filter((t) => {
        const s = t.status?.toLowerCase() ?? "";
        return s !== "solved" && s !== "closed";
      })
      .map((t) => t.id),
  );
  type ActivityList = Awaited<
    ReturnType<typeof mcp.contextA8C.fetchZendeskTicketActivity>
  >;
  const recentActivityByTicketId: Record<string, ActivityList> = {};
  await Promise.all(
    Array.from(activeTicketIds).map(async (id) => {
      try {
        recentActivityByTicketId[id] = await mcp.contextA8C
          .fetchZendeskTicketActivity(id, {
            projectSlug: detail.slug,
            limit: 5,
          });
      } catch {
        recentActivityByTicketId[id] = [];
      }
    }),
  );

  // Filter Fathom recordings to those whose title looks like it
  // belongs to this project — match against project name, partner
  // slug, or partner display name. Imperfect but cheap; the user
  // gets to see what hit and can tweak naming if matches are off.
  const allRecordings = recordingsResult.ok
    ? recordingsResult.data
    : (recordingsResult.cachedData ?? []);
  const projectRecordings = allRecordings
    .filter((r) =>
      recordingMatchesProject(
        r.title,
        detail.name,
        detail.partner,
        partnerProfile?.display_name,
      ),
    )
    .slice(0, 8);

  const projectDrafts = allDrafts.filter(
    (d) => d.project_slug === detail.slug,
  );
  const projectFollowUps = {
    active: filterFollowUpsForProject(allFollowUps.active, detail),
    resolved: filterFollowUpsForProject(allFollowUps.resolved, detail),
  };

  const tasks = parseProjectTasks(detail.body);
  const { open, done } = splitTasks(tasks);

  const isPartner = detail.kind === "partner";

  const configuredSources = [
    {
      label: "Slack",
      configured: Boolean(detail.primary_slack_channel),
      reason: !detail.primary_slack_channel ? "no channel configured" : undefined,
    },
    {
      label: "GitHub",
      configured: Boolean(detail.github_repo),
      reason: !detail.github_repo ? "no repo configured" : undefined,
    },
    {
      label: "Linear",
      configured: Boolean(
        detail.linear_project_id || detail.linear_project_slug,
      ),
      reason:
        !detail.linear_project_id && !detail.linear_project_slug
          ? "no project configured"
          : undefined,
    },
    {
      label: "Zendesk",
      configured: (detail.zendesk_tickets ?? []).length > 0,
      reason:
        (detail.zendesk_tickets ?? []).length > 0
          ? undefined
          : "no tickets configured",
    },
    {
      label: "P2",
      configured: Boolean(detail.p2_url),
      reason: !detail.p2_url ? "no post URL configured" : undefined,
    },
  ];

  return (
    <>
      <WorkbenchHeader project={detail} />
      <PageShell className="max-w-5xl">
        <NeedsDecisionPanel
          summary={stalls}
          apiKeyConfigured={agentStatus.configured}
        />

        <ForYouTodayPanel project={detail} />

        {isPartner ? <MilestonesPanel deadlines={detail.deadlines} /> : null}

        <LiveActivityFeed
          result={activityResult}
          configured={configuredSources}
        />

        <ProjectBriefPanel project={detail} body={detail.body} />

        <div className="grid gap-3 lg:grid-cols-2">
          <OpenItemsPanel
            projectSlug={detail.slug}
            open={open}
            done={done}
          />
          <DraftsForProjectPanel
            drafts={projectDrafts}
            projectName={detail.name}
          />
        </div>

        <ZendeskThreadsPanel
          projectSlug={detail.slug}
          tickets={zendeskTickets}
          followUps={projectFollowUps}
          recentActivityByTicketId={recentActivityByTicketId}
          defaultSearchQuery={
            partnerProfile?.display_name ?? detail.partner ?? detail.name
          }
          alwaysShow={isPartner}
        />

        <CallNotesPanel
          projectName={detail.name}
          recordings={projectRecordings}
        />

        {isPartner ? (
          <PartnerInfoPanel project={detail} partner={partnerProfile} />
        ) : null}

        <PersonalNotesPanel notes={detail.notes} />
      </PageShell>
    </>
  );
}

/**
 * Cheap title-match for routing Fathom recordings to a project. Splits
 * each candidate string into normalized tokens and looks for any token
 * (≥3 chars) appearing in the recording title. This catches:
 *   - "ClimateFirst Foundation Phase 2" matching titles with
 *     "ClimateFirst" or "Foundation" alone
 *   - Partner slugs like "the-pocket-nyc" matching "Pocket NYC"
 *   - The partner's display name matching its abbreviation
 *
 * False-positive prone for short common tokens; the ≥3 chars filter
 * + dropping noise words keeps it usable.
 */
function recordingMatchesProject(
  title: string | undefined,
  projectName: string,
  partnerSlug: string | undefined,
  partnerName: string | undefined,
): boolean {
  if (!title) return false;
  const haystack = title.toLowerCase();
  const tokens = new Set<string>();
  for (const s of [projectName, partnerSlug, partnerName]) {
    if (!s) continue;
    for (const t of s.toLowerCase().split(/[\s\-_/.]+/)) {
      if (t.length >= 3 && !STOP_TOKENS.has(t)) tokens.add(t);
    }
  }
  for (const t of tokens) {
    if (haystack.includes(t)) return true;
  }
  return false;
}

const STOP_TOKENS = new Set([
  "the",
  "and",
  "for",
  "phase",
  "project",
  "foundation",
  "inc",
  "llc",
  "corp",
  "team",
]);
