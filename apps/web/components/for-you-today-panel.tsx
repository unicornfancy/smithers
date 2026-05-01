"use client";

import * as React from "react";
import {
  AlertCircle,
  ChevronRight,
  KeyRound,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import type { SuggestNextStepOutput } from "@smithers/agents";
import type { Project } from "@smithers/vault";

import { suggestNextStepAction } from "@/app/projects/[slug]/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  project: Project;
  /** Whether ANTHROPIC_API_KEY is set on the server. */
  apiKeyConfigured: boolean;
}

/**
 * For-You-Today panel. Click the Suggest button → server runs the
 * suggest-next-step agent → 1-3 specific actions render with rationale.
 * The empty state explains the panel; the unconfigured state shows what
 * to set so the button works.
 *
 * Each pick links back to the relevant surface (Zendesk thread, follow-up
 * row, open item) via #anchor on this same page so the user lands on the
 * row they need to act on.
 */
export function ForYouTodayPanel({ project, apiKeyConfigured }: Props) {
  const [pending, startTransition] = React.useTransition();
  const [data, setData] = React.useState<SuggestNextStepOutput | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [hasRun, setHasRun] = React.useState(false);

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await suggestNextStepAction(project.slug);
        setHasRun(true);
        if (r.ok) {
          setData(r.data);
        } else if (r.reason === "not-configured") {
          setError(
            "Set ANTHROPIC_API_KEY in .env.local at the repo root to enable suggestions.",
          );
        } else {
          setError(r.message ?? "Agent call failed");
        }
      } catch (err) {
        setHasRun(true);
        const msg = err instanceof Error ? err.message : "Agent call failed";
        setError(msg);
        toast.error(msg);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="text-muted-foreground size-4" />
          For you today
          <span className="ml-auto">
            {apiKeyConfigured ? (
              <Button
                type="button"
                variant={hasRun ? "ghost" : "outline"}
                size="sm"
                onClick={run}
                disabled={pending}
                className="h-7 gap-1.5 text-xs"
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : hasRun ? (
                  <RefreshCw className="size-3.5" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {hasRun ? "Refresh" : "Suggest"}
              </Button>
            ) : null}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!apiKeyConfigured ? (
          <NotConfiguredNotice />
        ) : error ? (
          <ErrorNotice message={error} onRetry={run} disabled={pending} />
        ) : !hasRun && !data ? (
          <EmptyHint />
        ) : pending && !data ? (
          <LoadingHint />
        ) : data ? (
          <Picks data={data} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function Picks({ data }: { data: SuggestNextStepOutput }) {
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm leading-snug">
        {data.framing}
      </p>
      {data.picks.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">
          Nothing pressing — clear afternoon.
        </p>
      ) : (
        <ol className="flex flex-col divide-y">
          {data.picks.map((p, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0"
            >
              <span className="text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium tabular-nums">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-foreground text-sm leading-snug">
                  {p.action}
                </p>
                <p className="text-muted-foreground text-[11px] leading-snug">
                  {p.rationale}
                </p>
                {p.target.kind !== "none" ? (
                  <p className="text-muted-foreground/80 mt-0.5 inline-flex items-center gap-1 text-[10px]">
                    <ChevronRight className="size-2.5" />
                    {targetLabel(p.target)}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function targetLabel(target: SuggestNextStepOutput["picks"][number]["target"]): string {
  switch (target.kind) {
    case "zendesk":
      return `Zendesk thread #${target.ticket_id}`;
    case "follow-up":
      return `Follow-up · ${target.follow_up_id.slice(0, 8)}`;
    case "open-item":
      return `Open Item · ${target.task_id.slice(0, 8)}`;
    case "none":
      return "Project-level";
  }
}

function NotConfiguredNotice() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 p-3 text-[12px] text-muted-foreground">
      <KeyRound className="mt-0.5 size-3.5 shrink-0" />
      <div>
        <p className="text-foreground font-medium">Agent runtime not configured</p>
        <p className="opacity-90">
          Set{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            ANTHROPIC_API_KEY
          </code>{" "}
          in <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            .env.local
          </code>{" "}
          at the repo root and restart the dev server. Suggestions will
          appear here once the key is loaded.
        </p>
      </div>
    </div>
  );
}

function EmptyHint() {
  return (
    <p className="text-muted-foreground text-sm italic">
      Click Suggest to get 1-3 specific actions for this project — pulled
      from active threads, follow-ups, and open items.
    </p>
  );
}

function LoadingHint() {
  return (
    <p className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
      <Loader2 className="size-3.5 animate-spin" />
      Picking next steps…
    </p>
  );
}

function ErrorNotice({
  message,
  onRetry,
  disabled,
}: {
  message: string;
  onRetry: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-amber-500/30",
        "bg-amber-50 p-2 text-[12px] text-amber-900",
        "dark:bg-amber-950/30 dark:text-amber-200",
      )}
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium">Couldn&rsquo;t generate suggestions</p>
        <p className="opacity-90">{message}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRetry}
          disabled={disabled}
          className="h-6 w-fit gap-1 px-1.5 text-[11px]"
        >
          <RefreshCw className="size-3" />
          Try again
        </Button>
      </div>
    </div>
  );
}
