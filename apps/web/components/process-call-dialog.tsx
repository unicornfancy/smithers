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

import type {
  ComposeCallRecapOutput,
  DraftP2UpdateOutput,
} from "@smithers/agents";

import {
  acceptCallActionItemsAction,
  acceptCallDecisionsAction,
  acceptCallFollowUpsAction,
  analyzeCallAction,
  composeCallRecapAction,
  draftP2UpdateFromCallAction,
} from "@/app/projects/[slug]/actions";
import { cn } from "@/lib/utils";
import { AiDraftDialog } from "@/components/ai-draft-dialog";
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
  const [acceptingDecisions, startAcceptDecisions] = React.useTransition();
  const [decisionsAdded, setDecisionsAdded] = React.useState(false);
  const [cachedMeta, setCachedMeta] = React.useState<{
    cached: boolean;
    analyzed_at: string;
    notes_path?: string;
  } | null>(null);

  // Side-drafts: P2 post + recap message. Each opens its own
  // AiDraftDialog with the agent output.
  const [p2Pending, startP2] = React.useTransition();
  const [p2Data, setP2Data] = React.useState<DraftP2UpdateOutput | null>(null);
  const [p2Open, setP2Open] = React.useState(false);
  const [recapPending, startRecap] = React.useTransition();
  const [recapData, setRecapData] = React.useState<ComposeCallRecapOutput | null>(
    null,
  );
  const [recapOpen, setRecapOpen] = React.useState(false);

  function reset() {
    setData(null);
    setError(null);
    setSelectedActions(new Set());
    setSelectedFollowUps(new Set());
    setAcceptedSummary(false);
    setDecisionsAdded(false);
    setCachedMeta(null);
  }

  function run(force = false) {
    reset();
    setOpen(true);
    startTransition(async () => {
      try {
        const r = await analyzeCallAction(
          projectSlug,
          recording.recording_id,
          recording.source_url,
          {
            force,
            recording_title: recording.title ?? undefined,
            recorded_at: recording.recorded_at ?? undefined,
          },
        );
        if (r.ok) {
          setData(r.data);
          setCachedMeta({
            cached: r.cached,
            analyzed_at: r.analyzed_at,
            notes_path: r.notes_path,
          });
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

  function acceptDecisions() {
    if (!data || data.decisions.length === 0) return;
    startAcceptDecisions(async () => {
      try {
        const r = await acceptCallDecisionsAction(
          projectSlug,
          data.decisions,
          recording.title ?? "Untitled call",
          recording.recorded_at,
          recording.source_url,
        );
        if (r.added > 0) {
          toast.success(
            `Added ${r.added} decision${r.added === 1 ? "" : "s"} to the project body`,
          );
          setDecisionsAdded(true);
        } else {
          toast.info("Nothing to add");
        }
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't add decisions",
        );
      }
    });
  }

  function generateP2() {
    startP2(async () => {
      try {
        const r = await draftP2UpdateFromCallAction(
          projectSlug,
          recording.recording_id,
          recording.source_url,
        );
        if (r.ok) {
          setP2Data(r.data);
          setP2Open(true);
        } else if (r.reason === "not-configured") {
          toast.error(
            "Set ANTHROPIC_API_KEY in .env.local to enable AI drafts",
          );
        } else {
          toast.error(r.message ?? "Couldn't draft P2 update");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't draft P2 update",
        );
      }
    });
  }

  function generateRecap() {
    startRecap(async () => {
      try {
        const r = await composeCallRecapAction(
          projectSlug,
          recording.recording_id,
          recording.source_url,
        );
        if (r.ok) {
          setRecapData(r.data);
          setRecapOpen(true);
        } else if (r.reason === "not-configured") {
          toast.error(
            "Set ANTHROPIC_API_KEY in .env.local to enable AI drafts",
          );
        } else {
          toast.error(r.message ?? "Couldn't draft recap");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't draft recap",
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
        onClick={() => run(false)}
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
            {cachedMeta ? (
              <div className="mt-1 flex items-center gap-2 text-[11px]">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
                    cachedMeta.cached
                      ? "bg-muted text-muted-foreground"
                      : "bg-emerald-100/60 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
                  )}
                  title={
                    cachedMeta.notes_path
                      ? `Saved at ${cachedMeta.notes_path}`
                      : undefined
                  }
                >
                  {cachedMeta.cached
                    ? `Loaded from saved notes · ${formatRelative(cachedMeta.analyzed_at)}`
                    : `Saved · ${formatRelative(cachedMeta.analyzed_at)}`}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => run(true)}
                  disabled={running}
                  className="h-6 gap-1 px-1.5 text-[11px]"
                  title="Discard the saved analysis and run the agent again"
                >
                  {running ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Sparkles className="size-3" />
                  )}
                  Re-analyze
                </Button>
              </div>
            ) : null}
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
              {/* Side-drafts: open transcript-derived modals on demand. */}
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed bg-muted/30 px-3 py-2">
                <span className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                  From this call
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={generateRecap}
                  disabled={recapPending}
                  className="h-6 gap-1 px-1.5 text-[11px]"
                >
                  {recapPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Sparkles className="size-3" />
                  )}
                  Compose recap message
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={generateP2}
                  disabled={p2Pending}
                  className="h-6 gap-1 px-1.5 text-[11px]"
                >
                  {p2Pending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Sparkles className="size-3" />
                  )}
                  Draft P2 update
                </Button>
              </div>
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
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={acceptDecisions}
                      disabled={acceptingDecisions || decisionsAdded}
                      className="h-6 gap-1 px-1.5 text-[11px]"
                    >
                      {acceptingDecisions ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : decisionsAdded ? (
                        <Check className="size-3" />
                      ) : (
                        <CheckCircle2 className="size-3" />
                      )}
                      {decisionsAdded
                        ? "Added"
                        : `Add ${data.decisions.length} to project body`}
                    </Button>
                  }
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

      <AiDraftDialog
        open={p2Open}
        onOpenChange={setP2Open}
        title={p2Data ? `P2 draft: ${p2Data.title}` : "P2 draft"}
        meta={p2Data ? "Markdown · paste into the P2 composer" : ""}
        rationale={p2Data?.rationale ?? ""}
        body={p2Data?.body ?? ""}
        saveAsDraft={
          p2Data
            ? {
                suggestedTitle: `P2 — ${p2Data.title}`,
                projectSlug,
                sourceAgent: "draft-p2-update",
                channel: "p2",
              }
            : undefined
        }
      />

      <AiDraftDialog
        open={recapOpen}
        onOpenChange={setRecapOpen}
        title="Recap message"
        meta={
          recapData
            ? `${recapData.channel === "email" ? "Email" : "Slack"} · post-call recap`
            : ""
        }
        rationale={recapData?.rationale ?? ""}
        subject={
          recapData?.channel === "email" ? recapData.subject : undefined
        }
        body={recapData?.draft ?? ""}
        saveAsDraft={
          recapData
            ? {
                suggestedTitle: `Recap — ${recording.title ?? recording.recording_id}`,
                projectSlug,
                sourceAgent: "compose-call-recap",
                channel: recapData.channel,
              }
            : undefined
        }
      />
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

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
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
