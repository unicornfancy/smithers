"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ListChecks,
  Loader2,
  MessageSquare,
  Quote,
  Save,
  Send,
  Sparkles,
  Star,
} from "lucide-react";
import { toast } from "sonner";

import type {
  AnalyzeCallTranscriptOutput,
  CallActionItem,
  CallFollowUp,
} from "@smithers/agents";
import type { CallRecordingRef, ContextItem } from "@smithers/mcp-client";

import type {
  ComposeCallRecapOutput,
  DraftP2UpdateOutput,
} from "@smithers/agents";

import {
  acceptCallActionItemsAction,
  acceptCallDecisionsAction,
  acceptCallFollowUpsAction,
  analyzeCallAction,
  chatAboutCallAction,
  composeCallRecapAction,
  draftP2UpdateFromCallAction,
  fetchTranscriptAction,
  saveChatToCallNotesAction,
} from "@/app/projects/[slug]/actions";
import { cn } from "@/lib/utils";
import { AiDraftDialog } from "@/components/ai-draft-dialog";
import { DraftContextPickerDialog } from "@/components/draft-context-picker-dialog";
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
  // Per-item priority/due_date overrides. Initialized from agent suggestions;
  // user can change them before accepting.
  const [actionPriorities, setActionPriorities] = React.useState<
    Record<number, "high" | "medium" | "low" | "">
  >({});
  const [actionDueDates, setActionDueDates] = React.useState<
    Record<number, string>
  >({});
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

  // Re-analyze: optional one-off instructions appended to the system prompt.
  const [additionalInstructions, setAdditionalInstructions] =
    React.useState("");

  // Chat panel state.
  const [transcript, setTranscript] = React.useState<string | null>(null);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [chatMessages, setChatMessages] = React.useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);
  const [chatInput, setChatInput] = React.useState("");
  const [chatPending, startChatSend] = React.useTransition();
  const [chatSaved, setChatSaved] = React.useState(false);
  const [chatSaving, startChatSave] = React.useTransition();
  const chatBottomRef = React.useRef<HTMLDivElement>(null);

  // Scroll chat thread to bottom whenever messages change.
  React.useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Side-drafts: P2 post + recap message. Each goes through the Phase H
  // context picker before generation, then opens its own AiDraftDialog
  // with the agent output.
  const [p2Pending, startP2] = React.useTransition();
  const [p2Data, setP2Data] = React.useState<DraftP2UpdateOutput | null>(null);
  const [p2Open, setP2Open] = React.useState(false);
  const [p2PickerOpen, setP2PickerOpen] = React.useState(false);
  const [p2LastContext, setP2LastContext] = React.useState<ContextItem[]>([]);
  // Mirror of the picker's intent field — replayed on regenerate so the
  // same steering carries through "give me another shot at it" cycles.
  const [p2LastIntent, setP2LastIntent] = React.useState("");
  const [recapPending, startRecap] = React.useTransition();
  const [recapData, setRecapData] = React.useState<ComposeCallRecapOutput | null>(
    null,
  );
  const [recapOpen, setRecapOpen] = React.useState(false);
  const [recapPickerOpen, setRecapPickerOpen] = React.useState(false);
  const [recapLastContext, setRecapLastContext] = React.useState<ContextItem[]>(
    [],
  );
  const [recapLastIntent, setRecapLastIntent] = React.useState("");

  function reset() {
    setData(null);
    setError(null);
    setSelectedActions(new Set());
    setSelectedFollowUps(new Set());
    setActionPriorities({});
    setActionDueDates({});
    setAcceptedSummary(false);
    setDecisionsAdded(false);
    setCachedMeta(null);
    setChatMessages([]);
    setChatSaved(false);
    setChatInput("");
  }

  function run(force = false) {
    const instructions = additionalInstructions.trim();
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
            additionalInstructions: instructions || undefined,
          },
        );
        if (r.ok) {
          setData(r.data);
          // Store transcript if the action returned it (fresh run only).
          if (r.transcript) setTranscript(r.transcript);
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
          // Seed overrides from agent suggestions.
          const priorities: Record<number, "high" | "medium" | "low" | ""> = {};
          const dueDates: Record<number, string> = {};
          r.data.action_items.forEach((a, i) => {
            priorities[i] = a.priority ?? "";
            dueDates[i] = a.due_date ?? "";
          });
          setActionPriorities(priorities);
          setActionDueDates(dueDates);
          // Clear instructions after a successful run.
          setAdditionalInstructions("");
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
    const picks: CallActionItem[] = data.action_items
      .filter((_, i) => selectedActions.has(i))
      .map((a, _unused, _arr) => {
        // find the original index in data.action_items for the override lookup
        const origIdx = data.action_items.indexOf(a);
        const priority = actionPriorities[origIdx] || undefined;
        const due_date = actionDueDates[origIdx] || undefined;
        return {
          ...a,
          priority: priority as "high" | "medium" | "low" | undefined,
          due_date,
        };
      });
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
        // Don't router.refresh() here — the workbench re-renders would
        // move this recording from unprocessed → processed, unmount the
        // row, and close this dialog mid-flow. Refresh happens once on
        // dialog close (see Dialog onOpenChange below).
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
          `Added ${r.added} follow-up${r.added === 1 ? "" : "s"}`,
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
        // Refresh deferred to dialog close — see acceptActions for why.
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
            `Added ${r.added} decision${r.added === 1 ? "" : "s"} to the project log`,
          );
          setDecisionsAdded(true);
        } else {
          toast.info("Nothing to add");
        }
        if (r.warnings && r.warnings.length > 0) {
          for (const w of r.warnings) toast.warning(w);
        }
        // Refresh deferred to dialog close — see acceptActions for why.
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't add decisions",
        );
      }
    });
  }

  function generateP2() {
    setP2PickerOpen(true);
  }

  function actuallyGenerateP2(items: ContextItem[], intent: string) {
    if (p2Pending) return;
    setP2LastContext(items);
    setP2LastIntent(intent);
    startP2(async () => {
      try {
        const r = await draftP2UpdateFromCallAction(
          projectSlug,
          recording.recording_id,
          recording.source_url,
          items,
          intent || undefined,
        );
        if (r.ok) {
          setP2Data(r.data);
          setP2PickerOpen(false);
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

  async function regenerateP2() {
    if (p2Pending) return;
    await new Promise<void>((resolve) =>
      startP2(async () => {
        try {
          const r = await draftP2UpdateFromCallAction(
            projectSlug,
            recording.recording_id,
            recording.source_url,
            p2LastContext,
            p2LastIntent || undefined,
          );
          if (r.ok) setP2Data(r.data);
          else toast.error(r.message ?? "Couldn't regenerate P2 update");
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Couldn't regenerate",
          );
        } finally {
          resolve();
        }
      }),
    );
  }

  function generateRecap() {
    setRecapPickerOpen(true);
  }

  function actuallyGenerateRecap(items: ContextItem[], intent: string) {
    if (recapPending) return;
    setRecapLastContext(items);
    setRecapLastIntent(intent);
    startRecap(async () => {
      try {
        const r = await composeCallRecapAction(
          projectSlug,
          recording.recording_id,
          recording.source_url,
          items,
          intent || undefined,
        );
        if (r.ok) {
          setRecapData(r.data);
          setRecapPickerOpen(false);
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

  async function regenerateRecap() {
    if (recapPending) return;
    await new Promise<void>((resolve) =>
      startRecap(async () => {
        try {
          const r = await composeCallRecapAction(
            projectSlug,
            recording.recording_id,
            recording.source_url,
            recapLastContext,
            recapLastIntent || undefined,
          );
          if (r.ok) setRecapData(r.data);
          else toast.error(r.message ?? "Couldn't regenerate recap");
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Couldn't regenerate",
          );
        } finally {
          resolve();
        }
      }),
    );
  }

  function sendChatMessage() {
    const msg = chatInput.trim();
    if (!msg || chatPending) return;
    const currentTranscript = transcript;
    if (!currentTranscript) {
      // Transcript not yet loaded; fetch it first, then re-send.
      startChatSend(async () => {
        const tr = await fetchTranscriptAction(
          recording.recording_id,
          recording.source_url,
        );
        if (!tr.ok) {
          toast.error(tr.message);
          return;
        }
        setTranscript(tr.transcript);
        const optimistic: Array<{ role: "user" | "assistant"; content: string }> =
          [...chatMessages, { role: "user", content: msg }];
        setChatMessages(optimistic);
        setChatInput("");
        setChatSaved(false);
        const r = await chatAboutCallAction(
          projectSlug,
          tr.transcript,
          chatMessages,
          msg,
        );
        if (r.ok) {
          setChatMessages([
            ...optimistic,
            { role: "assistant", content: r.reply },
          ]);
        } else {
          toast.error(r.message);
          // Roll back the optimistic user message on error.
          setChatMessages(chatMessages);
          setChatInput(msg);
        }
      });
      return;
    }
    const optimistic: Array<{ role: "user" | "assistant"; content: string }> = [
      ...chatMessages,
      { role: "user", content: msg },
    ];
    setChatMessages(optimistic);
    setChatInput("");
    setChatSaved(false);
    startChatSend(async () => {
      const r = await chatAboutCallAction(
        projectSlug,
        currentTranscript,
        chatMessages,
        msg,
      );
      if (r.ok) {
        setChatMessages([
          ...optimistic,
          { role: "assistant", content: r.reply },
        ]);
      } else {
        toast.error(r.message);
        setChatMessages(chatMessages);
        setChatInput(msg);
      }
    });
  }

  function saveChat() {
    if (chatMessages.length === 0 || chatSaving) return;
    startChatSave(async () => {
      const r = await saveChatToCallNotesAction(
        projectSlug,
        recording.recording_id,
        chatMessages,
      );
      if (r.ok && r.changed) {
        toast.success("Saved. View it on this call's notes page (Chat section).");
        setChatSaved(true);
      } else if (r.ok && !r.changed) {
        toast.info(
          "No Call Notes file found for this recording — analyze the call first",
        );
      } else if (!r.ok) {
        toast.error(r.message);
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
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            // Refresh once on close so the workbench picks up everything
            // the user accepted in this session (tasks, follow-ups,
            // decisions, draft saves). Refreshing on each accept would
            // re-render the row that hosts this dialog and close it
            // mid-flow.
            router.refresh();
          }
        }}
      >
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
              <div className="mt-1 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-[11px]">
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
                <textarea
                  rows={3}
                  value={additionalInstructions}
                  onChange={(e) => setAdditionalInstructions(e.target.value)}
                  placeholder="Additional instructions for this run, e.g. focus on action items for Katie"
                  className="w-full resize-none rounded-md border bg-background px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
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
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <select
                              value={actionPriorities[i] ?? ""}
                              onChange={(e) =>
                                setActionPriorities((prev) => ({
                                  ...prev,
                                  [i]: e.target.value as "high" | "medium" | "low" | "",
                                }))
                              }
                              className="h-5 rounded border bg-background px-1 text-[11px] text-foreground"
                              aria-label="Priority"
                            >
                              <option value="">no priority</option>
                              <option value="high">high</option>
                              <option value="medium">medium</option>
                              <option value="low">low</option>
                            </select>
                            <input
                              type="date"
                              value={actionDueDates[i] ?? ""}
                              onChange={(e) =>
                                setActionDueDates((prev) => ({
                                  ...prev,
                                  [i]: e.target.value,
                                }))
                              }
                              className="h-5 rounded border bg-background px-1 text-[11px] text-foreground"
                              aria-label="Due date"
                            />
                          </div>
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
                      Add {selectedFollowUps.size} to follow-ups
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
                        : `Add ${data.decisions.length} to project log`}
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

              {/* Chat about this call */}
              <div className="border-t pt-3">
                <button
                  type="button"
                  onClick={() => setChatOpen((v) => !v)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <MessageSquare className="text-muted-foreground size-3.5" />
                  <span className="text-foreground text-xs font-medium uppercase tracking-wide">
                    Chat about this call
                  </span>
                  <span className="ml-auto">
                    {chatOpen ? (
                      <ChevronDown className="text-muted-foreground size-3.5" />
                    ) : (
                      <ChevronRight className="text-muted-foreground size-3.5" />
                    )}
                  </span>
                </button>

                {chatOpen ? (
                  <div className="mt-2 flex flex-col gap-2">
                    {/* Message thread */}
                    {chatMessages.length > 0 ? (
                      <div className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-md border p-2">
                        {chatMessages.map((msg, i) => (
                          <div
                            key={i}
                            className={cn(
                              "flex flex-col gap-0.5",
                              msg.role === "user" ? "items-end" : "items-start",
                            )}
                          >
                            <span className="text-muted-foreground text-[10px] font-medium">
                              {msg.role === "user" ? "You" : "Smithers"}
                            </span>
                            <p
                              className={cn(
                                "max-w-[90%] rounded-md px-2.5 py-1.5 text-[12px] leading-relaxed",
                                msg.role === "user"
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-foreground",
                              )}
                            >
                              {msg.content}
                            </p>
                          </div>
                        ))}
                        {chatPending ? (
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" />
                            Thinking…
                          </div>
                        ) : null}
                        <div ref={chatBottomRef} />
                      </div>
                    ) : null}

                    {/* Input row */}
                    <div className="flex gap-1.5">
                      <textarea
                        rows={2}
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendChatMessage();
                          }
                        }}
                        placeholder="Ask something about this call…"
                        disabled={chatPending}
                        className="min-w-0 flex-1 resize-none rounded-md border bg-background px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={sendChatMessage}
                        disabled={chatPending || !chatInput.trim()}
                        className="h-auto self-stretch px-2.5"
                      >
                        {chatPending ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Send className="size-3" />
                        )}
                      </Button>
                    </div>

                    {/* Save conversation */}
                    {chatMessages.length > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={saveChat}
                        disabled={chatSaving || chatSaved}
                        className="h-6 gap-1 self-end px-1.5 text-[11px]"
                      >
                        {chatSaving ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : chatSaved ? (
                          <Check className="size-3" />
                        ) : (
                          <Save className="size-3" />
                        )}
                        {chatSaved ? "Saved" : "Save conversation"}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <DraftContextPickerDialog
        open={p2PickerOpen}
        onOpenChange={setP2PickerOpen}
        title={`Draft P2 update from this call`}
        projectSlug={projectSlug}
        onGenerate={actuallyGenerateP2}
        busy={p2Pending}
      />

      <AiDraftDialog
        open={p2Open}
        onOpenChange={setP2Open}
        title={p2Data ? `P2 draft: ${p2Data.title}` : "P2 draft"}
        meta={p2Data ? "Markdown · paste into the P2 composer" : ""}
        rationale={p2Data?.rationale ?? ""}
        body={p2Data?.body ?? ""}
        onRegenerate={regenerateP2}
        onChangeContext={() => {
          setP2Open(false);
          setP2PickerOpen(true);
        }}
        regenerating={p2Pending}
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

      <DraftContextPickerDialog
        open={recapPickerOpen}
        onOpenChange={setRecapPickerOpen}
        title={`Draft recap message from this call`}
        projectSlug={projectSlug}
        onGenerate={actuallyGenerateRecap}
        busy={recapPending}
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
        onRegenerate={regenerateRecap}
        onChangeContext={() => {
          setRecapOpen(false);
          setRecapPickerOpen(true);
        }}
        regenerating={recapPending}
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
