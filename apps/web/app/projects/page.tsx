import Link from "next/link";
import { cookies } from "next/headers";

import type { ProjectStatus } from "@smithers/vault";

import { AppHeader } from "@/components/app-header";
import { EmptyState, VaultMissingNotice } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { ProjectCard } from "@/components/project-card";
import {
  ProjectsFilterBar,
  type ProjectsSortKey,
} from "@/components/projects-filter-bar";
import { Button } from "@/components/ui/button";
import { getVault } from "@/lib/server/vault";

// Same ordering as the filter-bar dropdown — kept in sync by hand because
// the bar is a client component and re-importing through it would drag
// the Tailwind classes back into the server bundle.
const STATUS_RANK: Record<ProjectStatus, number> = {
  hot: 0,
  active: 1,
  "at-risk": 2,
  secondary: 3,
  cold: 4,
  research: 5,
  planning: 6,
  launched: 7,
  archived: 8,
};

function isSortKey(v: string | undefined): v is ProjectsSortKey {
  return v === "name" || v === "status" || v === "activity";
}

export const metadata = {
  title: "Projects · Smithers",
};

// Don't cache while we're iterating; vault edits should show up immediately.
export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    archived?: string;
    sort?: string;
  }>;
}) {
  const { status: filterStatus, archived, sort: sortParam } = await searchParams;
  const showArchived = archived === "1";

  // Sort persistence: URL ?sort= wins (shareable links), then the
  // cookie written on the last selection, then the "name" default.
  // The cookie is written client-side by ProjectsFilterBar whenever
  // the user changes the dropdown.
  let sort: ProjectsSortKey = "name";
  if (isSortKey(sortParam)) {
    sort = sortParam;
  } else {
    const cookieStore = await cookies();
    const cookieSort = cookieStore.get("smithers_projects_sort")?.value;
    if (isSortKey(cookieSort)) sort = cookieSort;
  }

  const vault = await getVault();
  const status = vault.status();

  let projects: Awaited<ReturnType<typeof vault.listProjects>> = [];
  let listError: string | undefined;
  if (status.exists) {
    try {
      projects = await vault.listProjects();
    } catch (err) {
      listError = err instanceof Error ? err.message : String(err);
    }
  }

  // Count per status across the unfiltered list so the dropdown can show
  // counts and only offer statuses that have projects.
  const statusCounts: Partial<Record<ProjectStatus, number>> = {};
  for (const p of projects) {
    statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
  }

  const visibleProjects = projects
    .filter((p) => {
      if (!showArchived && p.status === "archived") return false;
      if (filterStatus && filterStatus !== "all" && p.status !== filterStatus) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sort === "status") {
        const rankDelta =
          (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99);
        return rankDelta !== 0 ? rankDelta : a.name.localeCompare(b.name);
      }
      if (sort === "activity") {
        // Newest-modified first; missing/blank timestamps fall to the
        // bottom so unconfigured projects don't masquerade as recent.
        const ta = a.modified_at || "";
        const tb = b.modified_at || "";
        if (ta && tb) return tb.localeCompare(ta);
        if (ta) return -1;
        if (tb) return 1;
        return a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });

  const partnerCount = visibleProjects.filter((p) => p.kind === "partner").length;
  const teamCount = visibleProjects.filter((p) => p.kind === "team").length;
  const personalCount = visibleProjects.filter((p) => p.kind === "personal").length;
  const filterActive = (filterStatus && filterStatus !== "all") || showArchived;

  return (
    <>
      <AppHeader
        title="Projects"
        subtitle={
          status.exists
            ? filterActive
              ? `${visibleProjects.length} of ${projects.length} · ${partnerCount} partner · ${teamCount} team · ${personalCount} personal`
              : `${visibleProjects.length} · ${partnerCount} partner · ${teamCount} team · ${personalCount} personal`
            : "Vault not configured yet"
        }
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href="/projects/onboard">Onboarding</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/projects/new">+ New project</Link>
            </Button>
          </div>
        }
      />
      <PageShell>
        {!status.exists ? (
          <VaultMissingNotice vaultPath={status.vault_path} />
        ) : null}

        {listError ? (
          <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-md border px-4 py-3 text-sm">
            Could not list projects: {listError}
          </div>
        ) : null}

        {status.exists && !listError && projects.length > 0 ? (
          <ProjectsFilterBar
            currentStatus={filterStatus ?? "all"}
            showArchived={showArchived}
            currentSort={sort}
            counts={statusCounts}
          />
        ) : null}

        {status.exists && !listError && projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Add a project folder under Projects/ in your vault, or use the New Project flow once it lands."
          />
        ) : null}

        {projects.length > 0 && visibleProjects.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            No projects match the current filter.
          </p>
        ) : null}

        {visibleProjects.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleProjects.map((p) => (
              <ProjectCard key={p.slug} project={p} />
            ))}
          </div>
        ) : null}
      </PageShell>
    </>
  );
}
