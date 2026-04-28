import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { EmptyState, VaultMissingNotice } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { ProjectCard } from "@/components/project-card";
import { Button } from "@/components/ui/button";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "Projects · Smithers",
};

// Don't cache while we're iterating; vault edits should show up immediately.
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
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

  const partnerCount = projects.filter((p) => p.kind === "partner").length;
  const teamCount = projects.filter((p) => p.kind === "team").length;
  const personalCount = projects.filter((p) => p.kind === "personal").length;

  return (
    <>
      <AppHeader
        title="Projects"
        subtitle={
          status.exists
            ? `${projects.length} total · ${partnerCount} partner · ${teamCount} team · ${personalCount} personal`
            : "Vault not configured yet"
        }
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link href="/setup">New project</Link>
          </Button>
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

        {status.exists && !listError && projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Add a project folder under Projects/ in your vault, or use the New Project flow once it lands."
          />
        ) : null}

        {projects.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map((p) => (
              <ProjectCard key={p.slug} project={p} />
            ))}
          </div>
        ) : null}
      </PageShell>
    </>
  );
}
