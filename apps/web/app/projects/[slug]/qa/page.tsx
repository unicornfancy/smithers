import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/page-shell";
import { QaLauncherCard } from "@/components/qa/qa-launcher-card";
import { QaRunHistoryCard } from "@/components/qa/qa-run-history-card";
import { Button } from "@/components/ui/button";
import {
  detectKosh,
  listPendingQaRuns,
  listQaRuns,
} from "@/lib/server/kosh";
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
    title: project
      ? `QA · ${project.name} · Smithers`
      : "QA · Smithers",
  };
}

export default async function ProjectQaPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const vault = await getVault();
  if (!vault.status().exists) notFound();
  const project = await vault.readProject(slug);
  if (!project) notFound();

  const [detection, pending, history] = await Promise.all([
    detectKosh(),
    listPendingQaRuns(slug),
    listQaRuns(slug),
  ]);

  return (
    <>
      <AppHeader
        title={`QA · ${project.name}`}
        subtitle="Kosh-powered functional, performance, and accessibility audits"
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/projects/${slug}`}>
              <ArrowLeft className="mr-1 size-3.5" />
              Workbench
            </Link>
          </Button>
        }
      />
      <PageShell>
        <QaLauncherCard
          projectSlug={slug}
          stagingUrl={project.staging_url ?? ""}
          productionUrl={project.production_url ?? ""}
          detection={{
            ready: detection.ready,
            reason: detection.reason ?? null,
            claudeCli: detection.claude_cli,
            koshPath: detection.kosh_path,
          }}
          pendingRuns={pending.map((r) => ({
            id: r.id,
            test_type: r.test_type,
            target_url: r.target_url,
            status: r.status,
            started_at: r.started_at,
          }))}
        />
        <QaRunHistoryCard
          projectSlug={slug}
          runs={history.map((r) => ({
            id: r.id,
            test_type: r.test_type,
            target_url: r.target_url,
            env: r.env,
            status: r.status,
            started_at: r.started_at,
            completed_at: r.completed_at,
            counts: {
              critical: r.counts_critical,
              high: r.counts_high,
              medium: r.counts_medium,
              low: r.counts_low,
            },
            source: r.source,
            has_md: Boolean(r.report_html_relpath || r.report_md_relpath),
          }))}
        />
      </PageShell>
    </>
  );
}
