import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Markdown } from "@/components/markdown";
import { PageShell } from "@/components/page-shell";
import { QaFindingsIssueBuilder } from "@/components/qa/qa-findings-issue-builder";
import { QaGateFailedCard } from "@/components/qa/qa-gate-failed-card";
import { QaRunControls } from "@/components/qa/qa-run-controls";
import { QaUnknownCommandCard } from "@/components/qa/qa-unknown-command-card";
import { QaVaultPathChips } from "@/components/qa/qa-vault-path-chips";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getQaRunVaultPaths, readQaRunReport } from "@/lib/server/kosh";
import { parseKoshFindings } from "@/lib/server/kosh-findings";
import { getVault } from "@/lib/server/vault";

interface Params {
  slug: string;
  runId: string;
}

export const dynamic = "force-dynamic";

const TEST_LABEL: Record<string, string> = {
  "functional-design": "Functional & design",
  performance: "Performance",
  a11y: "Accessibility",
  aeo: "AEO (Answer Engine Optimization)",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { runId } = await params;
  return { title: `QA run ${runId.slice(0, 12)} · Smithers` };
}

export default async function QaRunDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug, runId } = await params;
  const [result, vaultPaths, vault] = await Promise.all([
    readQaRunReport(runId),
    getQaRunVaultPaths(runId),
    getVault(),
  ]);
  if (!result) notFound();
  const { run, md, html, log, json } = result;
  if (run.project_slug !== slug) notFound();

  const findings = parseKoshFindings(json);
  const project = await vault.readProject(slug).catch(() => null);
  const githubRepo = project?.github_repo ?? null;

  const isActive = run.status === "queued" || run.status === "running";

  return (
    <>
      <AppHeader
        title={`${TEST_LABEL[run.test_type] ?? run.test_type} · ${run.target_url}`}
        subtitle={`Run started ${run.started_at} · status: ${run.status}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/projects/${slug}/qa`}>
                <ArrowLeft className="mr-1 size-3.5" />
                Back to QA
              </Link>
            </Button>
            {run.report_json_relpath ? (
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`/api/qa-runs/${runId}/json`}
                  prefetch={false}
                  target="_blank"
                >
                  JSON
                  <ExternalLink className="ml-1 size-3.5" />
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />
      <PageShell>
        {isActive ? (
          <QaRunControls
            runId={run.id}
            projectSlug={slug}
            status={run.status}
          />
        ) : null}

        {run.status === "failed" &&
        run.failure_kind?.startsWith("gated:") ? (
          <QaGateFailedCard
            runId={run.id}
            projectSlug={slug}
            testType={run.test_type}
            originalUrl={run.target_url}
            gateType={
              (run.failure_kind.slice("gated:".length) as
                | "coming-soon"
                | "password"
                | "private") ?? "coming-soon"
            }
          />
        ) : run.status === "failed" &&
          run.failure_kind?.startsWith("unknown-command:") ? (
          <QaUnknownCommandCard
            command={run.failure_kind.slice("unknown-command:".length)}
          />
        ) : run.status === "failed" ? (
          <Card className="border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Run failed</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs">
                {run.error_message ?? "(no error message captured)"}
              </pre>
            </CardContent>
          </Card>
        ) : null}

        {run.status === "completed" && vaultPaths ? (
          <QaVaultPathChips
            jsonAbsPath={vaultPaths.json_abs_path}
            mdAbsPath={vaultPaths.md_abs_path}
            htmlAbsPath={vaultPaths.html_abs_path}
          />
        ) : null}

        {run.status === "completed" && findings.length > 0 ? (
          <QaFindingsIssueBuilder
            projectSlug={slug}
            runId={run.id}
            findings={findings}
            githubRepo={githubRepo}
          />
        ) : null}

        {html ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Report</CardTitle>
              <p className="text-muted-foreground text-xs">
                Saved to Hive Mind at{" "}
                <code className="bg-muted rounded px-1 text-[11px]">
                  {run.report_html_relpath}
                </code>
              </p>
            </CardHeader>
            <CardContent>
              {/* Kosh's HTML output is self-contained (inline CSS/JS,
                  embedded screenshots). Render inside a sandboxed iframe
                  so its styles don't bleed into Smithers's chrome and any
                  JS runs isolated from the parent origin. allow-scripts
                  covers the collapsible-section interactivity; no other
                  permissions granted. srcDoc lets us stream the body
                  from server props without a separate API round-trip. */}
              <iframe
                title="Kosh QA report"
                srcDoc={html}
                sandbox="allow-scripts"
                className="h-[80vh] w-full rounded border"
              />
            </CardContent>
          </Card>
        ) : md ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Report (Markdown — legacy)</CardTitle>
              <p className="text-muted-foreground text-xs">
                Saved to Hive Mind at{" "}
                <code className="bg-muted rounded px-1 text-[11px]">
                  {run.report_md_relpath}
                </code>{" "}
                — pre-Kosh v2 run. Newer runs render as inline HTML instead.
              </p>
            </CardHeader>
            <CardContent>
              <article className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown source={md} />
              </article>
            </CardContent>
          </Card>
        ) : run.status === "completed" ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Report (JSON only)</CardTitle>
              <p className="text-muted-foreground text-xs">
                Markdown generation failed or kosh&apos;s script wasn&apos;t
                available — the JSON below was saved to Hive Mind at{" "}
                <code className="bg-muted rounded px-1 text-[11px]">
                  {run.report_json_relpath}
                </code>
              </p>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted overflow-x-auto rounded p-3 text-xs">
                {JSON.stringify(json, null, 2)}
              </pre>
            </CardContent>
          </Card>
        ) : null}

        {log ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Run log</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted max-h-96 overflow-auto rounded p-3 text-xs">
                {log}
              </pre>
            </CardContent>
          </Card>
        ) : null}
      </PageShell>
    </>
  );
}
