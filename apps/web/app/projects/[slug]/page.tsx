import { notFound } from "next/navigation";

import {
  filterFollowUpsForProject,
  parseProjectTasks,
  splitTasks,
} from "@smithers/vault";

import { LiveActivityFeed } from "@/components/live-activity-feed";
import { PageShell } from "@/components/page-shell";
import { WorkbenchHeader } from "@/components/workbench-header";
import {
  CallNotesPanel,
  DraftsForProjectPanel,
  FollowUpsForProjectPanel,
  ForYouTodayPanel,
  MilestonesPanel,
  OpenItemsPanel,
  PartnerInfoPanel,
  PersonalNotesPanel,
  ProjectBriefPanel,
} from "@/components/workbench-panels";
import { getMcpClient } from "@/lib/server/mcp";
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
  const [allDrafts, allFollowUps, activityResult, partnerResult] =
    await Promise.all([
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
          zendesk_org: detail.zendesk_org,
          p2_url: detail.p2_url,
          primary_slack_channel: detail.primary_slack_channel,
          team_slack_channel: detail.team_slack_channel,
          partner: detail.partner,
        },
      }),
      detail.partner
        ? mcp.hiveMind.getPartner({ partner_slug: detail.partner })
        : Promise.resolve(null),
    ]);

  const partnerProfile =
    partnerResult && partnerResult.ok
      ? partnerResult.data
      : (partnerResult?.cachedData ?? null);

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
      configured: Boolean(detail.zendesk_org),
      reason: !detail.zendesk_org ? "no org configured" : undefined,
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
        <ForYouTodayPanel project={detail} />

        {isPartner ? <MilestonesPanel deadlines={detail.deadlines} /> : null}

        <LiveActivityFeed
          result={activityResult}
          configured={configuredSources}
        />

        <ProjectBriefPanel project={detail} body={detail.body} />

        <div className="grid gap-3 lg:grid-cols-2">
          <OpenItemsPanel open={open} done={done} />
          <DraftsForProjectPanel
            drafts={projectDrafts}
            projectName={detail.name}
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <FollowUpsForProjectPanel
            followUps={projectFollowUps}
            projectName={detail.name}
          />
          <CallNotesPanel projectName={detail.name} />
        </div>

        {isPartner ? (
          <PartnerInfoPanel project={detail} partner={partnerProfile} />
        ) : null}

        <PersonalNotesPanel notes={detail.notes} />
      </PageShell>
    </>
  );
}
