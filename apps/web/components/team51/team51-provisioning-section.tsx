"use client";

import * as React from "react";
import Link from "next/link";
import {
  Copy,
  ExternalLink,
  PlusCircle,
  Server,
  Terminal,
} from "lucide-react";

import { PressableCloneSiteDialog } from "@/components/team51/pressable-clone-site-dialog";
import { PressableCreateSiteDialog } from "@/components/team51/pressable-create-site-dialog";
import { RunWpCliDialog } from "@/components/team51/run-wp-cli-dialog";
import { WpcomCreateSiteDialog } from "@/components/team51/wpcom-create-site-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Team51RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

interface RecentRun {
  id: string;
  command: string;
  status: Team51RunStatus;
  started_at: string;
  failure_kind: string | null;
}

interface Props {
  projectSlug: string;
  suggestedName: string;
  defaultRepository: string;
  /** Pressable clone-site source — from project's production_url. */
  defaultSourceSite: string;
  /** WP-CLI target — falls back through staging_url / production_url. */
  defaultWpCliSite: string;
  recentRuns: RecentRun[];
}

const STATUS_TONE: Record<Team51RunStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  running:
    "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  completed:
    "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  failed: "bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
  cancelled: "bg-muted text-muted-foreground",
};

/**
 * Workbench section for team51-cli-backed provisioning workflows.
 * v1 exposes only `wpcom:create-site`; more will land as we work
 * through the top-used commands (pressable create/clone, wp-cli
 * variants).
 *
 * Sits on the Knowledge tab because provisioning is a
 * project-lifecycle concern, not a daily-flow one.
 */
export function Team51ProvisioningSection({
  projectSlug,
  suggestedName,
  defaultRepository,
  defaultSourceSite,
  defaultWpCliSite,
  recentRuns,
}: Props) {
  const [wpcomOpen, setWpcomOpen] = React.useState(false);
  const [pressableOpen, setPressableOpen] = React.useState(false);
  const [cloneOpen, setCloneOpen] = React.useState(false);
  const [wpCliOpen, setWpCliOpen] = React.useState(false);

  return (
    <>
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="text-muted-foreground size-4" />
            Provisioning
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Runs the{" "}
            <code className="font-mono text-[11px]">team51</code> CLI for
            workflows you&apos;d normally do in the terminal. Smithers
            collects the answers here, then opens a Terminal window
            running the composed command. You watch the terminal for
            prompts (Symfony&apos;s confirmation, 1Password biometric);
            when the run finishes it posts the log back to Smithers
            automatically. First launch triggers a one-time macOS
            &ldquo;Allow Terminal automation&rdquo; permission — click
            Allow.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => setWpcomOpen(true)}
              className="gap-1.5"
            >
              <PlusCircle className="size-3.5" />
              Create WordPress.com site
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setPressableOpen(true)}
              className="gap-1.5"
            >
              <Server className="size-3.5" />
              Create Pressable site
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setCloneOpen(true)}
              className="gap-1.5"
            >
              <Copy className="size-3.5" />
              Clone Pressable site
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setWpCliOpen(true)}
              className="gap-1.5"
            >
              <Terminal className="size-3.5" />
              Run WP-CLI
            </Button>
          </div>

          {recentRuns.length > 0 ? (
            <div className="space-y-1.5 border-t pt-3">
              <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                Recent runs
              </p>
              <ul className="flex flex-col divide-y text-xs">
                {recentRuns.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0"
                  >
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[r.status]}`}
                    >
                      {r.status}
                    </span>
                    <code className="text-muted-foreground font-mono text-[11px]">
                      {r.command}
                    </code>
                    <span className="text-muted-foreground text-[11px]">
                      · {r.started_at.slice(11, 16)}
                    </span>
                    {r.failure_kind ? (
                      <span className="text-rose-700 dark:text-rose-300 text-[11px]">
                        · {r.failure_kind}
                      </span>
                    ) : null}
                    <Link
                      href={`/projects/${projectSlug}/team51/${r.id}`}
                      className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-0.5 text-[11px] underline-offset-2 hover:underline"
                    >
                      View
                      <ExternalLink className="size-2.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <WpcomCreateSiteDialog
        open={wpcomOpen}
        onOpenChange={setWpcomOpen}
        projectSlug={projectSlug}
        suggestedName={suggestedName}
        defaultRepository={defaultRepository}
      />
      <PressableCreateSiteDialog
        open={pressableOpen}
        onOpenChange={setPressableOpen}
        projectSlug={projectSlug}
        suggestedName={suggestedName}
        defaultRepository={defaultRepository}
      />
      <PressableCloneSiteDialog
        open={cloneOpen}
        onOpenChange={setCloneOpen}
        projectSlug={projectSlug}
        defaultSourceSite={defaultSourceSite}
      />
      <RunWpCliDialog
        open={wpCliOpen}
        onOpenChange={setWpCliOpen}
        projectSlug={projectSlug}
        defaultSite={defaultWpCliSite}
      />
    </>
  );
}
