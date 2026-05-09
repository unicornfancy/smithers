"use client";

import {
  ArrowRight,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import type { TopThreeOutput } from "@smithers/agents";

import type { TopThreeResponse } from "@/app/api/agents/top-three/route";
import type { TopThreeCandidate } from "@/lib/server/top-three";
import { Top3RowActions } from "@/components/top3-row-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  /** Server-computed top-N candidates for the rules-based default render. */
  initialCandidates: TopThreeCandidate[];
  apiKeyConfigured: boolean;
  /** Candidate ids the user has pinned. Rendered with a pin marker + unpin button. */
  pinnedIds: string[];
  /**
   * Cached LLM picks, hydrated server-side. When present, the card opens
   * directly to "llm" mode without burning a fresh API call. The user
   * can still click "Regenerate" for a forced refresh.
   */
  cachedLlm?: {
    output: TopThreeOutput;
    candidates: TopThreeCandidate[];
  };
}

type State =
  | { kind: "rules" }
  | { kind: "loading" }
  | {
      kind: "llm";
      output: TopThreeOutput;
      candidates: TopThreeCandidate[];
    }
  | { kind: "error"; message: string; missingKey: boolean };

const LLM_CONFIDENCE_THRESHOLD = 0.7;

export function TopThreeCard({
  initialCandidates,
  apiKeyConfigured,
  pinnedIds,
  cachedLlm,
}: Props) {
  // Gate cached LLM picks: when Claude self-reported low confidence, fall
  // back to the rules-based view so we don't surface picks Claude itself
  // flagged as guesses. The user can still click Regenerate to retry.
  const cachedConfidence = cachedLlm?.output.confidence ?? 1;
  const cachedLlmIsTrusted =
    cachedLlm !== undefined && cachedConfidence >= LLM_CONFIDENCE_THRESHOLD;
  const [state, setState] = useState<State>(
    cachedLlmIsTrusted && cachedLlm
      ? { kind: "llm", output: cachedLlm.output, candidates: cachedLlm.candidates }
      : { kind: "rules" },
  );
  const pinnedSet = new Set(pinnedIds);

  async function generate() {
    if (!apiKeyConfigured) {
      toast.error(
        "Set ANTHROPIC_API_KEY in .env.local to generate Top 3 with Claude.",
      );
      return;
    }
    setState({ kind: "loading" });
    try {
      // The user is explicitly clicking "Generate" / "Regenerate", so
      // bypass the day's cache and always do a fresh agent call.
      const res = await fetch("/api/agents/top-three?force=true", {
        method: "POST",
      });
      const json = (await res.json()) as TopThreeResponse;
      if (!json.ok || !json.output || !json.candidates) {
        setState({
          kind: "error",
          message: json.error ?? "Something went wrong.",
          missingKey: json.error_kind === "missing_api_key",
        });
        return;
      }
      setState({
        kind: "llm",
        output: json.output,
        candidates: json.candidates,
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
        missingKey: false,
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="text-muted-foreground size-4" />
              Top 3 for today
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              {state.kind === "llm"
                ? "Picked by Claude from " +
                  initialCandidates.length +
                  " candidates"
                : `Rules-based ranking · ${initialCandidates.length} candidates considered`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground gap-1.5"
            onClick={generate}
            disabled={
              !apiKeyConfigured ||
              state.kind === "loading" ||
              initialCandidates.length === 0
            }
            title={
              apiKeyConfigured
                ? "Refine the Top 3 with Claude"
                : "Set ANTHROPIC_API_KEY in .env.local to enable"
            }
          >
            {state.kind === "loading" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : state.kind === "llm" ? (
              <RefreshCw className="size-3" />
            ) : (
              <Sparkles className="size-3" />
            )}
            {state.kind === "llm" ? "Regenerate" : "Generate with Claude"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {initialCandidates.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No candidates yet. Add an open task to a project, a follow-up, or
            wait for a ping.
          </p>
        ) : null}

        {state.kind === "rules" && cachedLlm && !cachedLlmIsTrusted ? (
          <p className="text-muted-foreground text-xs italic">
            Claude returned low-confidence picks ({cachedConfidence.toFixed(2)}).
            Showing rules-based ranking — click Regenerate to retry.
          </p>
        ) : null}

        {state.kind === "rules" || state.kind === "loading" ? (
          <RulesView candidates={initialCandidates} pinnedSet={pinnedSet} />
        ) : null}

        {state.kind === "llm" ? (
          <LlmView
            output={state.output}
            candidates={state.candidates}
            pinnedSet={pinnedSet}
          />
        ) : null}

        {state.kind === "error" ? (
          <div className="space-y-2 text-sm">
            <p className="text-destructive">{state.message}</p>
            {state.missingKey ? (
              <p className="text-muted-foreground text-xs">
                Add{" "}
                <code className="bg-muted rounded px-1 py-0.5 font-mono">
                  ANTHROPIC_API_KEY=sk-ant-…
                </code>{" "}
                to{" "}
                <code className="bg-muted rounded px-1 py-0.5 font-mono">
                  apps/web/.env.local
                </code>
                , then restart the dev server.
              </p>
            ) : null}
            <RulesView candidates={initialCandidates} pinnedSet={pinnedSet} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RulesView({
  candidates,
  pinnedSet,
}: {
  candidates: TopThreeCandidate[];
  pinnedSet: Set<string>;
}) {
  const top3 = candidates.slice(0, 3);
  return (
    <ol className="flex flex-col divide-y">
      {top3.map((c, i) => {
        const pinned = pinnedSet.has(c.candidate_id);
        return (
          <li
            key={c.candidate_id}
            className="flex items-start gap-3 py-2 first:pt-0 last:pb-0"
          >
            <span className="text-muted-foreground w-5 shrink-0 text-sm font-semibold tabular-nums">
              {i + 1}.
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <CandidateLink candidate={c} className="text-sm leading-snug" />
              {c.context ? (
                <p className="text-muted-foreground text-xs">{c.context}</p>
              ) : null}
              <p className="text-muted-foreground text-[11px] italic">
                {pinned ? "📌 pinned" : `${sourceLabel(c.source)} · score ${c.score.toFixed(1)}`}
                {pinned ? ` · ${sourceLabel(c.source)}` : null}
              </p>
            </div>
            <Top3RowActions
              candidateId={c.candidate_id}
              pinned={pinned}
              label={c.task.slice(0, 40)}
            />
          </li>
        );
      })}
    </ol>
  );
}

function LlmView({
  output,
  candidates,
  pinnedSet,
}: {
  output: TopThreeOutput;
  candidates: TopThreeCandidate[];
  pinnedSet: Set<string>;
}) {
  const byId = new Map(candidates.map((c) => [c.candidate_id, c]));
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col divide-y">
        {output.picks.map((pick, i) => {
          const candidate = byId.get(pick.candidate_id);
          const pinned = pinnedSet.has(pick.candidate_id);
          return (
            <li
              key={pick.candidate_id}
              className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
            >
              <span className="text-muted-foreground w-5 shrink-0 text-sm font-semibold tabular-nums">
                {i + 1}.
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-sm font-medium leading-snug">
                  {pinned ? "📌 " : ""}
                  {pick.title}
                </p>
                <p className="text-muted-foreground text-sm leading-snug">
                  {pick.why}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="bg-foreground text-background inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium">
                    <ArrowRight className="size-3" />
                    {pick.next_action}
                  </span>
                  {candidate ? (
                    <CandidateLink
                      candidate={candidate}
                      className="text-muted-foreground hover:text-foreground text-[11px] underline-offset-2 hover:underline"
                      label={
                        candidate.project_name
                          ? `${candidate.project_name} · ${sourceLabel(candidate.source)}`
                          : sourceLabel(candidate.source)
                      }
                    />
                  ) : null}
                </div>
              </div>
              <Top3RowActions
                candidateId={pick.candidate_id}
                pinned={pinned}
                label={pick.title.slice(0, 40)}
              />
            </li>
          );
        })}
      </ol>
      {output.framing ? (
        <p className="border-l-muted-foreground/30 text-muted-foreground border-l-2 pl-3 text-xs italic">
          {output.framing}
        </p>
      ) : null}
    </div>
  );
}

function CandidateLink({
  candidate,
  className,
  label,
}: {
  candidate: TopThreeCandidate;
  className?: string;
  label?: string;
}) {
  const text = label ?? candidate.task;
  if (!candidate.href) {
    return <span className={className}>{text}</span>;
  }
  if (candidate.href.startsWith("http")) {
    return (
      <a
        href={candidate.href}
        target="_blank"
        rel="noreferrer"
        className={className}
      >
        {text}
      </a>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-typed-link-without-prefetch -- typed routes don't cover dynamic project slugs cleanly
    <Link
      href={candidate.href as never}
      className={className}
    >
      {text}
    </Link>
  );
}

function sourceLabel(source: TopThreeCandidate["source"]): string {
  switch (source) {
    case "ping":
      return "Inbound ping";
    case "follow_up":
      return "Follow-up";
    case "draft":
      return "Draft";
    case "project_task":
      return "Project task";
  }
}
