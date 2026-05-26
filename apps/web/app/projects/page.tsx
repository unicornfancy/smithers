import Link from "next/link";

import type { ProjectStatus } from "@smithers/vault";

import { AppHeader } from "@/components/app-header";
import { EmptyState, VaultMissingNotice } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { ProjectCard } from "@/components/project-card";
import { ProjectsFilterBar } from "@/components/projects-filter-bar";
import { Button } from "@/components/ui/button";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "Projects · Smithers",
};

// Don't cache while we're iterating; vault edits should show up immediately.
export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; archived?: string }>;
}) {
  const { status: filterStatus, archived } = await searchParams;
  const showArchived = archived === "1";

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

  const visibleProjects = projects.filter((p) => {
    if (!showArchived && p.status === "archived") return false;
    if (filterStatus && filterStatus !== "all" && p.status !== filterStatus) {
      return false;
    }
    return true;
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
