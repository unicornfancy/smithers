"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ListChecks,
  Loader2,
  Quote,
  Sparkles,
  Star,
} from "lucide-react";
import { toast } from "sonner";

import type {
  AnalyzeCallTranscriptOutput,
  CallActionItem,
  CallFollowUp,
} from "@smithers/agents";
import type { CallRecordingRef } from "@smithers/mcp-client";

import {
  acceptCallActionItemsAction,
  acceptCallFollowUpsAction,
  analyzeCallAction,
} from "@/app/projects/[slug]/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  projectSlug: string;
  recording: CallRecordingRef;
}

/**
 * "Process call" button + dialog. One click triggers transcript fetch
 * + agent analysis; result renders as four sections (summary, action
 * items, follow-ups, decisions, key quotes), each with its own accept
 * action where applicable. Action items + follow-ups write directly
 * into the vault; summary copies to clipboard.
 */
export function ProcessCallDialog({ projectSlug, recording }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [running, startTransition] = React.useTransition();
  const [data, setData] = React.useState<AnalyzeCallTranscriptOutput | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);

  // Selection state lets the user uncheck individual items before
  // accepting — defaults to "all selected" since the agent should be
  // returning curated picks already.
  const [selectedActions, setSelectedActions] = React.useState<Set<number>>(
    new Set(),
  );
  const [selectedFollowUps, setSelectedFollowUps] = React.useState<Set<number>>(
    new Set(),
  );
  const [acceptedSummary, setAcceptedSummary] = React.useState(false);
  const [acceptingActions, startAcceptActions] = React.useTransition();
  const [acceptingFollowUps, startAcceptFollowUps] = React.useTransition();

  function reset() {
    setData(null);
    setError(null);
    setSelectedActions(new Set());
    setSelectedFollowUps(new Set());
    setAcceptedSummary(false);
  }

  function run() {
    reset();
    setOpen(true);
    startTransition(async () => {
      try {
        const r = await analyzeCallAction(
          projectSlug,
          recording.recording_id,
          recording.source_url,
        );
        if (r.ok) {
          setData(r.data);
          setSelectedActions(
            new Set(r.data.action_items.map((_, i) => i)),
          );
          setSelectedFollowUps(
            new Set(r.data.follow_ups.map((_, i) => i)),
          );
        } else if (r.reason === "not-configured") {
          setError(
            "Set ANTHROPIC_API_KEY in .env.local to enable call analysis.",
          );
        } else {
          setError(r.message ?? "Couldn't analyze the call");
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't analyze the call",
        );
      }
    });
  }

  function toggleAction(i: number) {
    setSelectedActions((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function toggleFollowUp(i: number) {
    setSelectedFollowUps((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function acceptActions() {
    if (!data) return;
    const picks: CallActionItem[] = data.action_items.filter((_, i) =>
      selectedActions.has(i),
    );
    if (picks.length === 0) {
      toast.info("No action items selected");
      return;
    }
    startAcceptActions(async () => {
      try {
        const r = await acceptCallActionItemsAction(projectSlug, picks);
        toast.success(
          `Added ${r.added} task${r.added === 1 ? "" : "s"} to Open Items`,
        );
        // Drop accepted items from the visible list so the count is
        // honest after accept.
        setData((prev) =>
          prev
            ? {
                ...prev,
                action_items: prev.action_items.filter(
                  (_, i) => !selectedActions.has(i),
                ),
              }
            : prev,
        );
        setSelectedActions(new Set());
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't add tasks",
        );
      }
    });
  }

  function acceptFollowUps() {
    if (!data) return;
    const picks: CallFollowUp[] = data.follow_ups.filter((_, i) =>
      selectedFollowUps.has(i),
    );
    if (picks.length === 0) {
      toast.info("No follow-ups selected");
      return;
    }
    startAcceptFollowUps(async () => {
      try {
        const r = await acceptCallFollowUpsAction(
          projectSlug,
          picks,
          recording.source_url,
        );
        toast.success(
          `Added ${r.added} follow-up${r.added === 1 ? "" : "s"} to Follow-ups.md`,
        );
        setData((prev) =>
          prev
            ? {
                ...prev,
                follow_ups: prev.follow_ups.filter(
                  (_, i) => !selectedFollowUps.has(i),
                ),
              }
            : prev,
        );
        setSelectedFollowUps(new Set());
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't add follow-ups",
        );
      }
    });
  }

  async function copySummary() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.summary);
      setAcceptedSummary(true);
      toast.success("Summary copied to clipboard");
      setTimeout(() => setAcceptedSummary(false), 2000);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't copy summary",
      );
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={run}
        disabled={running}
        title="Analyze this call's transcript"
        className="h-6 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {running ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Sparkles className="size-3" />
        )}
        Process
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Process call: {recording.title ?? recording.recording_id}
            </DialogTitle>
            <DialogDescription>
              Pulls the transcript and extracts a summary, action items,
              follow-ups, decisions, and key quotes. Pick what to commit
              into the vault — items you uncheck stay here.
            </DialogDescription>
          </DialogHeader>

          {running && !data ? (
            <p className="text-muted-foreground inline-flex items-center gap-1.5 py-6 text-sm">
              <Loader2 className="size-3.5 animate-spin" />
              Fetching transcript and analyzing…
            </p>
          ) : error ? (
            <ErrorNotice message={error} />
          ) : data ? (
            <div className="max-h-[60vh] space-y-5 overflow-y-auto">
              <Section
                icon={<Sparkles className="size-3.5" />}
                title="Summary"
                action={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={copySummary}
                    className="h-6 gap-1 px-1.5 text-[11px]"
                  >
                    {acceptedSummary ? (
                      <Check className="size-3" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    {acceptedSummary ? "Copied" : "Copy"}
                  </Button>
                }
              >
                <p className="text-sm leading-relaxed">{data.summary}</p>
              </Section>

              {data.action_items.length > 0 ? (
                <Section
                  icon={<ListChecks className="size-3.5" />}
                  title={`Action items · ${data.action_items.length}`}
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={acceptActions}
                      disabled={
                        acceptingActions || selectedActions.size === 0
                      }
                      className="h-6 gap-1 px-1.5 text-[11px]"
                    >
                      {acceptingActions ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3" />
                      )}
                      Add {selectedActions.size} to Open Items
                    </Button>
                  }
                >
                  <ul className="flex flex-col divide-y">
                    {data.action_items.map((a, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 py-1.5 first:pt-0 last:pb-0"
                      >
                        <input
                          type="checkbox"
                          checked={selectedActions.has(i)}
                          onChange={() => toggleAction(i)}
                          className="mt-1"
                          aria-label={`Toggle action item: ${a.text}`}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <p className="text-sm leading-snug">{a.text}</p>
                          {a.owner && a.owner !== "unknown" ? (
                            <p className="text-muted-foreground text-[11px]">
                              owner: {a.owner}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              {data.follow_ups.length > 0 ? (
                <Section
                  icon={<Clock className="size-3.5" />}
                  title={`Follow-ups · ${data.follow_ups.length}`}
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={acceptFollowUps}
                      disabled={
                        acceptingFollowUps || selectedFollowUps.size === 0
                      }
                      className="h-6 gap-1 px-1.5 text-[11px]"
                    >
                      {acceptingFollowUps ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3" />
                      )}
                      Add {selectedFollowUps.size} to Follow-ups.md
                    </Button>
                  }
                >
                  <ul className="flex flex-col divide-y">
                    {data.follow_ups.map((f, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 py-1.5 first:pt-0 last:pb-0"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFollowUps.has(i)}
                          onChange={() => toggleFollowUp(i)}
                          className="mt-1"
                          aria-label={`Toggle follow-up: ${f.task}`}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <p className="text-sm leading-snug">{f.task}</p>
                          <p className="text-muted-foreground text-[11px]">
                            {f.follow_up_by ? `due ${f.follow_up_by} · ` : ""}
                            {f.rationale}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              {data.decisions.length > 0 ? (
                <Section
                  icon={<Star className="size-3.5" />}
                  title={`Decisions · ${data.decisions.length}`}
                >
                  <ul className="flex flex-col divide-y">
                    {data.decisions.map((d, i) => (
                      <li
                        key={i}
                        className="flex flex-col gap-0.5 py-1.5 first:pt-0 last:pb-0"
                      >
                        <p className="text-sm leading-snug">{d.text}</p>
                        {d.context ? (
                          <p className="text-muted-foreground text-[11px]">
                            {d.context}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              {data.key_quotes.length > 0 ? (
                <Section
                  icon={<Quote className="size-3.5" />}
                  title={`Key quotes · ${data.key_quotes.length}`}
                >
                  <ul className="flex flex-col gap-2">
                    {data.key_quotes.map((q, i) => (
                      <li
                        key={i}
                        className="border-l-2 border-muted pl-2"
                      >
                        <p className="text-sm leading-snug italic">
                          &ldquo;{q.text}&rdquo;
                        </p>
                        <p className="text-muted-foreground text-[11px]">
                          — {q.speaker}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Section({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <p className="text-foreground text-xs font-medium uppercase tracking-wide">
          {title}
        </p>
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      {children}
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-amber-500/30",
        "bg-amber-50 p-2 text-[12px] text-amber-900",
        "dark:bg-amber-950/30 dark:text-amber-200",
      )}
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">Couldn&rsquo;t process this call</p>
        <p className="opacity-90">{message}</p>
      </div>
    </div>
  );
}
