import { notFound } from "next/navigation";

import {
  filterFollowUpsForProject,
  parseProjectTasks,
  splitTasks,
} from "@smithers/vault";

import { PageShell } from "@/components/page-shell";
import { WorkbenchHeader } from "@/components/workbench-header";
import {
  CallNotesPanel,
  DraftsForProjectPanel,
  FollowUpsForProjectPanel,
  ForYouTodayPanel,
  LiveActivityPlaceholder,
  MilestonesPanel,
  OpenItemsPanel,
  PartnerInfoPanel,
  PersonalNotesPanel,
  ProjectBriefPanel,
} from "@/components/workbench-panels";
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
  const [allDrafts, allFollowUps] = await Promise.all([
    vault.listDrafts().catch(() => []),
    vault
      .listFollowUps()
      .catch(() => ({ active: [], resolved: [] }) as never),
  ]);

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

  return (
    <>
      <WorkbenchHeader project={detail} />
      <PageShell className="max-w-5xl">
        <ForYouTodayPanel project={detail} />

        {isPartner ? <MilestonesPanel deadlines={detail.deadlines} /> : null}

        <LiveActivityPlaceholder project={detail} />

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

        {isPartner ? <PartnerInfoPanel project={detail} /> : null}

        <PersonalNotesPanel notes={detail.notes} />
      </PageShell>
    </>
  );
}
