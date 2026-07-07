import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/page-shell";
import { Team51FailedCard } from "@/components/team51/team51-failed-card";
import { Team51RunControls } from "@/components/team51/team51-run-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTeam51Run, readTeam51RunLog } from "@/lib/server/team51";

interface Params {
  slug: string;
  runId: string;
}

export const dynamic = "force-dynamic";

const COMMAND_LABEL: Record<string, string> = {
  "wpcom:create-site": "Create WordPress.com site",
  "pressable:create-site": "Create Pressable site",
  "pressable:clone-site": "Clone Pressable site",
  "wpcom:run-site-wp-cli-command": "Run WP-CLI on WordPress.com site",
  "pressable:run-site-wp-cli-command": "Run WP-CLI on Pressable site",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { runId } = await params;
  return { title: `team51 run ${runId.slice(0, 10)} · Smithers` };
}

export default async function Team51RunDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug, runId } = await params;
  const run = await getTeam51Run(runId);
  if (!run) notFound();
  if (run.project_slug !== slug) notFound();

  const log = await readTeam51RunLog(runId).catch(() => null);

  const isActive = run.status === "queued" || run.status === "running";
  const args: string[] = safeParseJsonArray(run.args_json);

  return (
    <>
      <AppHeader
        title={`${COMMAND_LABEL[run.command] ?? run.command}`}
        subtitle={`Run started ${run.started_at} · status: ${run.status}`}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/projects/${slug}`}>
              <ArrowLeft className="mr-1 size-3.5" />
              Back to project
            </Link>
          </Button>
        }
      />
      <PageShell>
        {isActive ? (
          <Team51RunControls
            runId={run.id}
            projectSlug={slug}
            status={run.status as "queued" | "running"}
          />
        ) : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Command</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted overflow-x-auto rounded p-3 text-[11px]">
              team51 {run.command} {args.map(escapeArg).join(" ")}{" "}
              --no-interaction
            </pre>
          </CardContent>
        </Card>

        {run.status === "completed" ? (
          <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-300" />
                Completed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">
                Full log below. Look for URLs, credentials, and post-create
                steps in the tail — Smithers doesn&apos;t parse those into
                structured fields yet.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {run.status === "failed" && run.failure_kind ? (
          <Team51FailedCard
            projectSlug={slug}
            runId={run.id}
            failureKind={run.failure_kind}
            errorMessage={run.error_message}
            logTail={log}
          />
        ) : null}

        {log ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Run log</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted max-h-[70vh] overflow-auto rounded p-3 text-[11px]">
                {log}
              </pre>
            </CardContent>
          </Card>
        ) : null}
      </PageShell>
    </>
  );
}

function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Shell-safe rendering of an arg for the command preview. We don't
 * exec through a shell — this is display-only — but wrapping args
 * with spaces / special chars in single quotes makes the preview
 * copy-pasteable into a terminal without gotchas.
 */
function escapeArg(arg: string): string {
  if (/^[a-zA-Z0-9_@:./=-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}
