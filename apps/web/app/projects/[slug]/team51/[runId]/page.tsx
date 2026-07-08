import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, ExternalLink, XCircle } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/page-shell";
import { Team51RunPoll } from "@/components/team51/team51-run-poll";
import { Team51WriteBackButton } from "@/components/team51/team51-write-back-button";
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

  const args: string[] = safeParseJsonArray(run.args_json);
  const isActive = run.status === "queued" || run.status === "running";

  return (
    <>
      <AppHeader
        title={COMMAND_LABEL[run.command] ?? run.command}
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
        {isActive ? <Team51RunPoll /> : null}

        {isActive ? (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Running in Terminal
              </CardTitle>
              <p className="text-muted-foreground text-xs">
                Smithers opened a Terminal window that&apos;s running the
                CLI. Watch it for prompts (Symfony&apos;s &ldquo;Are you
                sure?&rdquo; confirmation, 1Password&apos;s biometric
                approval when credentials get written). This page will
                refresh when the command reports back — usually within
                seconds of the Terminal script finishing.
              </p>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">
                Leave the Terminal window open until you see &ldquo;Reported.
                Safe to close.&rdquo; If it closed early or the postback
                failed, hit Refresh — the log&apos;s still on disk.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Command</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted overflow-x-auto rounded p-3 text-[11px]">
              team51 {run.command} {args.map(escapeArg).join(" ")}
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
            <CardContent className="flex flex-col gap-3">
              {run.captured_url ? (
                <div className="flex flex-col gap-2">
                  <p className="text-muted-foreground text-xs">
                    Captured URL:
                  </p>
                  <a
                    href={run.captured_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-600 dark:text-sky-400 inline-flex items-center gap-1 font-mono text-xs underline-offset-2 hover:underline"
                  >
                    {run.captured_url}
                    <ExternalLink className="size-3" />
                  </a>
                  <Team51WriteBackButton
                    runId={run.id}
                    command={run.command}
                    projectSlug={slug}
                  />
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  No URL parsed from the log — this is expected for
                  WP-CLI runs and for commands whose output format
                  Smithers doesn&apos;t know yet.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {run.status === "failed" ? (
          <Card className="border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <XCircle className="size-4 text-rose-700 dark:text-rose-300" />
                Run failed
                {run.exit_code != null ? (
                  <span className="text-muted-foreground text-xs font-normal">
                    (exit {run.exit_code})
                  </span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">
                {run.error_message ??
                  "See the log below for the full CLI output."}
              </p>
            </CardContent>
          </Card>
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
        ) : isActive ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Run log</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">
                Log appears here after the Terminal script POSTs its
                output back to Smithers.
              </p>
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

function escapeArg(arg: string): string {
  if (/^[a-zA-Z0-9_@:./=-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}
