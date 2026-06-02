"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Calendar,
  CheckSquare,
  ChevronRight,
  CircleSlash,
  ExternalLink,
  FileText,
  FolderKanban,
  Inbox,
  Ticket,
  ListChecks,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import type { ProjectStatus } from "@smithers/vault";

import {
  addProjectTaskAction,
  attachZendeskTicketAction,
  createLinkedFollowUpAction,
  resolveFollowUpAction,
  snoozeFollowUpAction,
  toggleProjectTaskAction,
  updateProjectMetadataAction,
} from "@/app/projects/[slug]/actions";
import type {
  PaletteEntry,
  PaletteEntryKind,
  PaletteIndex,
} from "@/lib/server/palette-index";
import { rankEntries } from "@/lib/palette-score";
import { cn } from "@/lib/utils";

type PaletteAction =
  | { kind: "navigate"; label: string; href: string }
  | { kind: "add-task"; label: string; projectSlug: string }
  | { kind: "add-followup"; label: string; projectSlug: string; projectName: string }
  | { kind: "set-status"; label: string; projectSlug: string }
  | { kind: "view-status"; label: string; projectSlug: string }
  | { kind: "attach-zendesk"; label: string; projectSlug: string }
  | { kind: "mark-task-done"; label: string; projectSlug: string }
  | { kind: "resolve-follow-up"; label: string; followUpId: string }
  | { kind: "snooze-follow-up"; label: string; followUpId: string };

type Step =
  | { kind: "results" }
  | { kind: "actions"; entry: PaletteEntry }
  | { kind: "add-task-form"; entry: PaletteEntry; projectSlug: string }
  | {
      kind: "add-followup-form";
      entry: PaletteEntry;
      projectSlug: string;
      projectName: string;
    }
  | { kind: "set-status-form"; entry: PaletteEntry; projectSlug: string }
  | { kind: "view-status"; entry: PaletteEntry; projectSlug: string }
  | { kind: "attach-zendesk-form"; entry: PaletteEntry; projectSlug: string }
  | { kind: "mark-task-done-pick"; entry: PaletteEntry; projectSlug: string }
  | { kind: "snooze-follow-up-form"; entry: PaletteEntry; followUpId: string }
  | { kind: "ai-interpreting"; query: string }
  | {
      kind: "ai-confirm";
      query: string;
      intent: AiIntent;
      entry: PaletteEntry | null;
    }
  | { kind: "ai-error"; query: string; message: string };

interface AiIntent {
  intent: string;
  entry_id?: string;
  task_text?: string;
  follow_up_by?: string;
  status?: string;
  ticket_id?: string;
  task_id?: string;
  follow_up_id?: string;
  snooze_days?: number;
  confirmation: string;
  confidence: number;
}

const MAX_RESULTS = 30;

interface ProjectContext {
  name: string;
  status: string;
  priority: string | null;
  kind: string;
  partner: string | null;
  modified_at: string;
  zendesk_ticket_count: number;
  open_tasks: Array<{ task_id: string; text: string; section: string | null }>;
  open_followups_count: number;
}

const STATUS_CHOICES: ProjectStatus[] = [
  "research",
  "planning",
  "active",
  "hot",
  "secondary",
  "cold",
  "at-risk",
  "launched",
  "archived",
];

const SNOOZE_PRESETS: Array<{ label: string; days: number }> = [
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
];

export function AskSmithersPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [step, setStep] = React.useState<Step>({ kind: "results" });
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [index, setIndex] = React.useState<PaletteIndex | null>(null);
  const [indexLoading, setIndexLoading] = React.useState(false);
  const [indexError, setIndexError] = React.useState<string | null>(null);

  // Per-project context cache (key: project slug). View status + Mark
  // task done both pull from this, so jumping between them on the same
  // entry doesn't re-fetch.
  const [projectContext, setProjectContext] = React.useState<
    Record<string, ProjectContext | { error: string } | "loading">
  >({});

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const resultsRef = React.useRef<HTMLDivElement | null>(null);
  const actionsRef = React.useRef<HTMLDivElement | null>(null);
  const formRef = React.useRef<HTMLTextAreaElement | null>(null);
  const ticketRef = React.useRef<HTMLInputElement | null>(null);
  const [formText, setFormText] = React.useState("");
  const [followUpBy, setFollowUpBy] = React.useState(defaultFollowUpDate());
  const [ticketInput, setTicketInput] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("smithers:open-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("smithers:open-palette", onOpenEvent);
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    if (index || indexLoading) return;
    setIndexLoading(true);
    setIndexError(null);
    fetch("/api/palette-index")
      .then((r) => {
        if (!r.ok) throw new Error(`palette-index ${r.status}`);
        return r.json() as Promise<PaletteIndex>;
      })
      .then((data) => setIndex(data))
      .catch((err) => setIndexError(err instanceof Error ? err.message : "load failed"))
      .finally(() => setIndexLoading(false));
  }, [open, index, indexLoading]);

  React.useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        if (step.kind === "results") inputRef.current?.focus();
        else if (step.kind === "actions") actionsRef.current?.focus();
        else if (
          step.kind === "set-status-form" ||
          step.kind === "view-status" ||
          step.kind === "mark-task-done-pick" ||
          step.kind === "snooze-follow-up-form" ||
          step.kind === "ai-confirm" ||
          step.kind === "ai-error"
        )
          actionsRef.current?.focus();
        else if (step.kind === "attach-zendesk-form") ticketRef.current?.focus();
        else if (
          step.kind === "add-task-form" ||
          step.kind === "add-followup-form"
        )
          formRef.current?.focus();
      });
    } else {
      // Reset on close so the next open is a clean slate.
      setQuery("");
      setStep({ kind: "results" });
      setSelectedIndex(0);
      setFormText("");
      setFollowUpBy(defaultFollowUpDate());
      setTicketInput("");
    }
  }, [open, step.kind]);

  // Lazy-load project context whenever we enter a step that needs it.
  React.useEffect(() => {
    const slug = projectSlugForStep(step);
    if (!slug) return;
    if (projectContext[slug] && projectContext[slug] !== "loading") return;
    if (projectContext[slug] === "loading") return;
    setProjectContext((prev) => ({ ...prev, [slug]: "loading" }));
    fetch(`/api/palette-project/${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((data: ProjectContext | { error: string }) => {
        setProjectContext((prev) => ({ ...prev, [slug]: data }));
      })
      .catch((err) => {
        setProjectContext((prev) => ({
          ...prev,
          [slug]: { error: err instanceof Error ? err.message : "load failed" },
        }));
      });
  }, [step, projectContext]);

  const ranked = React.useMemo(() => {
    if (!index) return [];
    const trimmed = query.trim();
    if (!trimmed) {
      return index.entries.slice(0, MAX_RESULTS).map((entry) => ({
        entry,
        score: 0,
      }));
    }
    return rankEntries(trimmed, index.entries, MAX_RESULTS);
  }, [index, query]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  React.useEffect(() => {
    if (step.kind !== "results") return;
    const row = resultsRef.current?.querySelector<HTMLElement>(
      `[data-row-index="${selectedIndex}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, step.kind]);

  function actionsFor(entry: PaletteEntry): PaletteAction[] {
    const actions: PaletteAction[] = [];
    if (entry.href) {
      actions.push({
        kind: "navigate",
        label: `Open ${entry.label}`,
        href: entry.href,
      });
    }
    if (entry.kind === "project-vault" && entry.project_slug) {
      const slug = entry.project_slug;
      actions.push({ kind: "view-status", label: "View status", projectSlug: slug });
      actions.push({
        kind: "add-task",
        label: "Add task",
        projectSlug: slug,
      });
      actions.push({
        kind: "add-followup",
        label: "Add follow-up",
        projectSlug: slug,
        projectName: entry.label,
      });
      actions.push({
        kind: "mark-task-done",
        label: "Mark task done",
        projectSlug: slug,
      });
      actions.push({
        kind: "set-status",
        label: "Set status",
        projectSlug: slug,
      });
      actions.push({
        kind: "attach-zendesk",
        label: "Attach Zendesk ticket",
        projectSlug: slug,
      });
    }
    if (entry.kind === "follow-up") {
      const fid = entry.id.replace(/^follow-up:/, "");
      actions.push({
        kind: "resolve-follow-up",
        label: "Resolve follow-up",
        followUpId: fid,
      });
      actions.push({
        kind: "snooze-follow-up",
        label: "Snooze follow-up",
        followUpId: fid,
      });
    }
    return actions;
  }

  function pickEntry(entry: PaletteEntry) {
    const actions = actionsFor(entry);
    const first = actions[0];
    if (!first) return;
    if (actions.length === 1) {
      runAction(entry, first);
      return;
    }
    setStep({ kind: "actions", entry });
    setSelectedIndex(0);
  }

  async function runAction(entry: PaletteEntry, action: PaletteAction) {
    switch (action.kind) {
      case "navigate":
        setOpen(false);
        router.push(action.href);
        return;
      case "add-task":
        setStep({ kind: "add-task-form", entry, projectSlug: action.projectSlug });
        setFormText("");
        return;
      case "add-followup":
        setStep({
          kind: "add-followup-form",
          entry,
          projectSlug: action.projectSlug,
          projectName: action.projectName,
        });
        setFormText("");
        setFollowUpBy(defaultFollowUpDate());
        return;
      case "set-status":
        setStep({ kind: "set-status-form", entry, projectSlug: action.projectSlug });
        setSelectedIndex(0);
        return;
      case "view-status":
        setStep({ kind: "view-status", entry, projectSlug: action.projectSlug });
        return;
      case "attach-zendesk":
        setStep({
          kind: "attach-zendesk-form",
          entry,
          projectSlug: action.projectSlug,
        });
        setTicketInput("");
        return;
      case "mark-task-done":
        setStep({
          kind: "mark-task-done-pick",
          entry,
          projectSlug: action.projectSlug,
        });
        setSelectedIndex(0);
        return;
      case "resolve-follow-up":
        await runResolveFollowUp(action.followUpId, entry.label);
        return;
      case "snooze-follow-up":
        setStep({
          kind: "snooze-follow-up-form",
          entry,
          followUpId: action.followUpId,
        });
        setSelectedIndex(0);
        return;
    }
  }

  async function submitAddTask() {
    if (step.kind !== "add-task-form") return;
    const trimmed = formText.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await addProjectTaskAction(step.projectSlug, trimmed);
      toast.success(`Task added to ${step.entry.label}`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Add task failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAddFollowUp() {
    if (step.kind !== "add-followup-form") return;
    const trimmed = formText.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const result = await createLinkedFollowUpAction(step.projectSlug, {
        project: step.projectName,
        task: trimmed,
        follow_up_by: followUpBy || undefined,
      });
      if (result.ok) {
        toast.success(`Follow-up added to ${step.entry.label}`);
        setOpen(false);
      } else {
        toast.error(result.message ?? "Failed to add follow-up");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSetStatus(status: ProjectStatus) {
    if (step.kind !== "set-status-form") return;
    setSubmitting(true);
    try {
      await updateProjectMetadataAction(step.projectSlug, { status });
      toast.success(`${step.entry.label} → ${status}`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Set status failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAttachZendesk() {
    if (step.kind !== "attach-zendesk-form") return;
    const trimmed = ticketInput.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const result = await attachZendeskTicketAction(step.projectSlug, trimmed);
      if (result.added) {
        toast.success(`Ticket attached to ${step.entry.label} (${result.total} total)`);
      } else {
        toast.info("Ticket already attached");
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Attach failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMarkTaskDone(taskId: string, taskText: string) {
    if (step.kind !== "mark-task-done-pick") return;
    setSubmitting(true);
    try {
      await toggleProjectTaskAction(step.projectSlug, taskId, true);
      toast.success(`Done: ${taskText}`);
      // Invalidate the cached project context so a subsequent open
      // doesn't show the just-completed task.
      setProjectContext((prev) => {
        const next = { ...prev };
        delete next[step.projectSlug];
        return next;
      });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Mark done failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function runResolveFollowUp(followUpId: string, label: string) {
    setSubmitting(true);
    try {
      await resolveFollowUpAction("", followUpId);
      toast.success(`Resolved: ${label}`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSnoozeFollowUp(days: number) {
    if (step.kind !== "snooze-follow-up-form") return;
    setSubmitting(true);
    try {
      const result = await snoozeFollowUpAction("", step.followUpId, days);
      toast.success(`Snoozed until ${result.follow_up_by}`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Snooze failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function startAiDispatch() {
    const q = query.trim();
    if (!q) return;
    setStep({ kind: "ai-interpreting", query: q });
    try {
      const res = await fetch("/api/palette-query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const json = (await res.json()) as
        | { ok: true; data: AiIntent }
        | { ok: false; reason: string; message?: string };
      if (!json.ok) {
        setStep({
          kind: "ai-error",
          query: q,
          message: json.message ?? "Couldn't interpret query",
        });
        return;
      }
      const intent = json.data;
      const matchedEntry =
        intent.entry_id && index
          ? index.entries.find((e) => e.id === intent.entry_id) ?? null
          : null;
      if (intent.intent === "unknown" || intent.confidence < 0.5) {
        setStep({
          kind: "ai-error",
          query: q,
          message:
            intent.confirmation ||
            "I'm not sure what you meant. Try refining the query.",
        });
        return;
      }
      setStep({
        kind: "ai-confirm",
        query: q,
        intent,
        entry: matchedEntry,
      });
    } catch (err) {
      setStep({
        kind: "ai-error",
        query: q,
        message: err instanceof Error ? err.message : "Request failed",
      });
    }
  }

  async function runAiIntent() {
    if (step.kind !== "ai-confirm") return;
    const { intent, entry } = step;
    setSubmitting(true);
    try {
      switch (intent.intent) {
        case "navigate":
          if (!entry?.href) throw new Error("No navigation target");
          setOpen(false);
          router.push(entry.href);
          return;
        case "add-task": {
          if (!entry?.project_slug) throw new Error("No project to add to");
          if (!intent.task_text) throw new Error("No task text");
          await addProjectTaskAction(entry.project_slug, intent.task_text);
          toast.success(`Task added to ${entry.label}`);
          setOpen(false);
          return;
        }
        case "add-follow-up": {
          if (!entry?.project_slug) throw new Error("No project to add to");
          if (!intent.task_text) throw new Error("No follow-up text");
          const result = await createLinkedFollowUpAction(entry.project_slug, {
            project: entry.label,
            task: intent.task_text,
            follow_up_by: intent.follow_up_by || undefined,
          });
          if (result.ok) {
            toast.success(`Follow-up added to ${entry.label}`);
            setOpen(false);
          } else {
            toast.error(result.message ?? "Failed to add follow-up");
          }
          return;
        }
        case "view-status": {
          if (!entry?.project_slug) throw new Error("No project");
          setStep({
            kind: "view-status",
            entry,
            projectSlug: entry.project_slug,
          });
          return;
        }
        case "set-status": {
          if (!entry?.project_slug) throw new Error("No project");
          if (!intent.status) throw new Error("No status target");
          await updateProjectMetadataAction(entry.project_slug, {
            status: intent.status as ProjectStatus,
          });
          toast.success(`${entry.label} → ${intent.status}`);
          setOpen(false);
          return;
        }
        case "attach-zendesk": {
          if (!entry?.project_slug) throw new Error("No project");
          if (!intent.ticket_id) throw new Error("No ticket id");
          const result = await attachZendeskTicketAction(
            entry.project_slug,
            intent.ticket_id,
          );
          toast.success(
            result.added
              ? `Ticket attached to ${entry.label}`
              : "Ticket already attached",
          );
          setOpen(false);
          return;
        }
        case "mark-task-done": {
          if (!entry?.project_slug) throw new Error("No project");
          if (!intent.task_id) throw new Error("No task id");
          await toggleProjectTaskAction(
            entry.project_slug,
            intent.task_id,
            true,
          );
          toast.success(`Marked done in ${entry.label}`);
          setOpen(false);
          return;
        }
        case "resolve-follow-up": {
          const fid = intent.follow_up_id;
          if (!fid) throw new Error("No follow-up id");
          await resolveFollowUpAction("", fid);
          toast.success(`Follow-up resolved`);
          setOpen(false);
          return;
        }
        case "snooze-follow-up": {
          const fid = intent.follow_up_id;
          if (!fid) throw new Error("No follow-up id");
          const days = intent.snooze_days ?? 7;
          const result = await snoozeFollowUpAction("", fid, days);
          toast.success(`Snoozed until ${result.follow_up_by}`);
          setOpen(false);
          return;
        }
        default:
          throw new Error(`Unsupported intent: ${intent.intent}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Run failed");
    } finally {
      setSubmitting(false);
    }
  }

  function backToActions(entry: PaletteEntry) {
    const acts = actionsFor(entry);
    if (acts.length <= 1) {
      setStep({ kind: "results" });
    } else {
      setStep({ kind: "actions", entry });
    }
    setSelectedIndex(0);
  }

  const aiOptionVisible = query.trim().length > 0;
  const totalResultRows = ranked.length + (aiOptionVisible ? 1 : 0);

  function pickResultAt(i: number) {
    if (aiOptionVisible && i === 0) {
      void startAiDispatch();
      return;
    }
    const idx = aiOptionVisible ? i - 1 : i;
    const row = ranked[idx];
    if (row) pickEntry(row.entry);
  }

  function onResultsKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, Math.max(totalResultRows - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickResultAt(selectedIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  function onActionsKeyDown(e: React.KeyboardEvent) {
    if (step.kind !== "actions") return;
    const actions = actionsFor(step.entry);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, actions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = actions[selectedIndex];
      if (action) void runAction(step.entry, action);
    } else if (e.key === "Escape" || e.key === "Backspace") {
      e.preventDefault();
      setStep({ kind: "results" });
      setSelectedIndex(0);
    }
  }

  function onFormKeyDown(
    e: React.KeyboardEvent,
    submit: () => void | Promise<void>,
  ) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (step.kind !== "results") backToActions(getEntry(step));
    }
  }

  function onStatusPickKeyDown(e: React.KeyboardEvent) {
    if (step.kind !== "set-status-form") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, STATUS_CHOICES.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const choice = STATUS_CHOICES[selectedIndex];
      if (choice) void submitSetStatus(choice);
    } else if (e.key === "Escape") {
      e.preventDefault();
      backToActions(step.entry);
    }
  }

  function onTaskPickKeyDown(
    e: React.KeyboardEvent,
    openTasks: Array<{ task_id: string; text: string }>,
  ) {
    if (step.kind !== "mark-task-done-pick") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, openTasks.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const t = openTasks[selectedIndex];
      if (t) void submitMarkTaskDone(t.task_id, t.text);
    } else if (e.key === "Escape") {
      e.preventDefault();
      backToActions(step.entry);
    }
  }

  function onSnoozeKeyDown(e: React.KeyboardEvent) {
    if (step.kind !== "snooze-follow-up-form") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, SNOOZE_PRESETS.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const preset = SNOOZE_PRESETS[selectedIndex];
      if (preset) void submitSnoozeFollowUp(preset.days);
    } else if (e.key === "Escape") {
      e.preventDefault();
      backToActions(step.entry);
    }
  }

  function onViewStatusKeyDown(e: React.KeyboardEvent) {
    if (step.kind !== "view-status") return;
    if (e.key === "Escape" || e.key === "Backspace") {
      e.preventDefault();
      backToActions(step.entry);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Enter on the status view → navigate to the project page.
      if (step.entry.href) {
        setOpen(false);
        router.push(step.entry.href);
      }
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-background w-full max-w-xl overflow-hidden rounded-lg border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {renderStep()}
      </div>
    </div>
  );

  function renderStep() {
    if (step.kind === "results") return renderResults();
    if (step.kind === "actions") return renderActions(step.entry);
    if (step.kind === "add-task-form")
      return renderAddTaskForm(step.entry);
    if (step.kind === "add-followup-form")
      return renderAddFollowUpForm(step.entry);
    if (step.kind === "set-status-form")
      return renderSetStatusForm(step.entry);
    if (step.kind === "view-status")
      return renderViewStatus(step.entry, step.projectSlug);
    if (step.kind === "attach-zendesk-form")
      return renderAttachZendeskForm(step.entry);
    if (step.kind === "mark-task-done-pick")
      return renderMarkTaskDonePick(step.entry, step.projectSlug);
    if (step.kind === "snooze-follow-up-form")
      return renderSnoozeForm(step.entry);
    if (step.kind === "ai-interpreting") return renderAiInterpreting(step.query);
    if (step.kind === "ai-confirm")
      return renderAiConfirm(step.query, step.intent, step.entry);
    if (step.kind === "ai-error")
      return renderAiError(step.query, step.message);
    return null;
  }

  function renderResults() {
    const trimmed = query.trim();
    return (
      <>
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onResultsKeyDown}
            placeholder="Ask Smithers — search projects, follow-ups, pages…"
            className="flex-1 bg-transparent text-sm focus:outline-none"
          />
          <KeyboardHint label="Esc" />
        </div>
        <div className="text-muted-foreground border-b bg-muted/20 px-3 py-1.5 text-[11px] leading-snug">
          Pick a project to add tasks, follow-ups, set status, attach Zendesk
          tickets, and more. Pick a follow-up to resolve or snooze it.
        </div>
        <div ref={resultsRef} className="max-h-[50vh] overflow-y-auto py-1">
          {indexLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 px-3 py-6 text-sm">
              <Loader2 className="size-3.5 animate-spin" />
              Loading index…
            </div>
          ) : indexError ? (
            <div className="text-destructive px-3 py-6 text-sm">
              Couldn&apos;t load index: {indexError}
            </div>
          ) : (
            <>
              {aiOptionVisible ? (
                <AiOptionRow
                  query={trimmed}
                  selected={selectedIndex === 0}
                  onClick={() => {
                    setSelectedIndex(0);
                    void startAiDispatch();
                  }}
                />
              ) : null}
              {ranked.length === 0 && !aiOptionVisible ? (
                <div className="text-muted-foreground px-3 py-6 text-sm italic">
                  Start typing to search across projects, partners, follow-ups,
                  and pages.
                </div>
              ) : ranked.length === 0 ? (
                <div className="text-muted-foreground px-3 py-4 text-xs italic">
                  No direct matches — try Ask Smithers above for a free-form
                  query.
                </div>
              ) : (
                ranked.map((row, i) => {
                  const rowIndex = aiOptionVisible ? i + 1 : i;
                  return (
                    <ResultRow
                      key={row.entry.id}
                      entry={row.entry}
                      selected={rowIndex === selectedIndex}
                      rowIndex={rowIndex}
                      onClick={() => {
                        setSelectedIndex(rowIndex);
                        pickEntry(row.entry);
                      }}
                    />
                  );
                })
              )}
            </>
          )}
        </div>
        <PaletteFooter
          hints={[
            { keys: "↑↓", label: "navigate" },
            { keys: "↵", label: "select" },
            { keys: "esc", label: "close" },
          ]}
        />
      </>
    );
  }

  function renderAiInterpreting(q: string) {
    return (
      <>
        <div className="text-muted-foreground flex items-center gap-1.5 border-b px-3 py-2 text-xs">
          <Sparkles className="size-3.5" />
          <span className="text-foreground truncate font-medium">Ask Smithers</span>
          <ChevronRight className="size-3" />
          <span className="truncate italic">{q}</span>
        </div>
        <div className="text-muted-foreground flex items-center gap-2 px-3 py-8 text-sm">
          <Loader2 className="size-3.5 animate-spin" />
          Interpreting…
        </div>
        <PaletteFooter hints={[{ keys: "esc", label: "cancel" }]} />
      </>
    );
  }

  function renderAiConfirm(
    q: string,
    intent: AiIntent,
    entry: PaletteEntry | null,
  ) {
    return (
      <>
        <div className="text-muted-foreground flex items-center gap-1.5 border-b px-3 py-2 text-xs">
          <Sparkles className="size-3.5" />
          <span className="text-foreground truncate font-medium">Ask Smithers</span>
          <ChevronRight className="size-3" />
          <span className="truncate italic">{q}</span>
        </div>
        <div
          tabIndex={0}
          ref={actionsRef}
          className="space-y-3 p-3 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runAiIntent();
            } else if (e.key === "Escape" || e.key === "Backspace") {
              e.preventDefault();
              setStep({ kind: "results" });
            }
          }}
        >
          <p className="text-sm">{intent.confirmation}</p>
          <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt>Intent</dt>
            <dd className="font-mono">{intent.intent}</dd>
            {entry ? (
              <>
                <dt>Target</dt>
                <dd>{entry.label}</dd>
              </>
            ) : null}
            {intent.task_text ? (
              <>
                <dt>Text</dt>
                <dd className="truncate">{intent.task_text}</dd>
              </>
            ) : null}
            {intent.status ? (
              <>
                <dt>Status</dt>
                <dd>{intent.status}</dd>
              </>
            ) : null}
            {intent.ticket_id ? (
              <>
                <dt>Ticket</dt>
                <dd>#{intent.ticket_id}</dd>
              </>
            ) : null}
            {intent.follow_up_by ? (
              <>
                <dt>Follow-up by</dt>
                <dd>{intent.follow_up_by}</dd>
              </>
            ) : null}
            {intent.snooze_days ? (
              <>
                <dt>Snooze</dt>
                <dd>{intent.snooze_days} days</dd>
              </>
            ) : null}
            <dt>Confidence</dt>
            <dd>{(intent.confidence * 100).toFixed(0)}%</dd>
          </dl>
        </div>
        <PaletteFooter
          hints={[
            { keys: "↵", label: submitting ? "running…" : "confirm" },
            { keys: "esc", label: "back" },
          ]}
        />
      </>
    );
  }

  function renderAiError(q: string, message: string) {
    return (
      <>
        <div className="text-muted-foreground flex items-center gap-1.5 border-b px-3 py-2 text-xs">
          <Sparkles className="size-3.5" />
          <span className="text-foreground truncate font-medium">Ask Smithers</span>
          <ChevronRight className="size-3" />
          <span className="truncate italic">{q}</span>
        </div>
        <div
          tabIndex={0}
          ref={actionsRef}
          className="space-y-2 p-3 text-sm focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Backspace" || e.key === "Enter") {
              e.preventDefault();
              setStep({ kind: "results" });
            }
          }}
        >
          <p>{message}</p>
          <p className="text-muted-foreground text-xs">
            Try a more specific phrasing — name the project, the action, and
            the details. Example: &quot;add task to body dao: review the
            staging-url setup&quot;.
          </p>
        </div>
        <PaletteFooter hints={[{ keys: "esc", label: "back" }]} />
      </>
    );
  }

  function renderActions(entry: PaletteEntry) {
    const acts = actionsFor(entry);
    const navOnly = acts.length === 1 && acts[0]?.kind === "navigate";
    return (
      <>
        <Breadcrumb entry={entry} />
        <div
          ref={actionsRef}
          tabIndex={0}
          className="max-h-[40vh] overflow-y-auto py-1 focus:outline-none"
          onKeyDown={onActionsKeyDown}
        >
          {acts.map((action, i) => (
            <ActionRow
              key={actionKey(action)}
              action={action}
              selected={i === selectedIndex}
              onClick={() => void runAction(entry, action)}
            />
          ))}
          {navOnly ? (
            <p className="text-muted-foreground border-t px-3 py-2 text-[11px] italic leading-snug">
              {hintForNavOnly(entry.kind)}
            </p>
          ) : null}
        </div>
        <PaletteFooter
          hints={[
            { keys: "↑↓", label: "navigate" },
            { keys: "↵", label: "run" },
            { keys: "esc", label: "back" },
          ]}
        />
      </>
    );
  }

  function renderAddTaskForm(entry: PaletteEntry) {
    return (
      <>
        <Breadcrumb entry={entry} suffix={`Add task to ${entry.label}`} />
        <div className="p-3">
          <textarea
            ref={formRef}
            value={formText}
            onChange={(e) => setFormText(e.target.value)}
            onKeyDown={(e) => onFormKeyDown(e, submitAddTask)}
            rows={3}
            disabled={submitting}
            placeholder="What do you need to do?"
            className={textareaClass}
          />
        </div>
        <PaletteFooter
          hints={[
            { keys: "↵", label: submitting ? "saving…" : "add task" },
            { keys: "esc", label: "back" },
          ]}
        />
      </>
    );
  }

  function renderAddFollowUpForm(entry: PaletteEntry) {
    return (
      <>
        <Breadcrumb entry={entry} suffix={`Add follow-up to ${entry.label}`} />
        <div className="space-y-2 p-3">
          <textarea
            ref={formRef}
            value={formText}
            onChange={(e) => setFormText(e.target.value)}
            onKeyDown={(e) => onFormKeyDown(e, submitAddFollowUp)}
            rows={3}
            disabled={submitting}
            placeholder="What are you waiting on?"
            className={textareaClass}
          />
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            <Calendar className="size-3.5" />
            Follow-up by
            <input
              type="date"
              value={followUpBy}
              onChange={(e) => setFollowUpBy(e.target.value)}
              disabled={submitting}
              className="border-input bg-background rounded border px-2 py-1 text-xs"
            />
          </label>
        </div>
        <PaletteFooter
          hints={[
            { keys: "↵", label: submitting ? "saving…" : "add follow-up" },
            { keys: "esc", label: "back" },
          ]}
        />
      </>
    );
  }

  function renderSetStatusForm(entry: PaletteEntry) {
    return (
      <>
        <Breadcrumb entry={entry} suffix={`Set status of ${entry.label}`} />
        <div
          ref={actionsRef}
          tabIndex={0}
          className="max-h-[40vh] overflow-y-auto py-1 focus:outline-none"
          onKeyDown={onStatusPickKeyDown}
        >
          {STATUS_CHOICES.map((status, i) => (
            <button
              key={status}
              type="button"
              onClick={() => void submitSetStatus(status)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
                i === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50",
              )}
            >
              <Tag className="size-4 shrink-0 opacity-70" />
              <span className="flex-1 truncate">{status}</span>
            </button>
          ))}
        </div>
        <PaletteFooter
          hints={[
            { keys: "↑↓", label: "navigate" },
            { keys: "↵", label: submitting ? "saving…" : "set" },
            { keys: "esc", label: "back" },
          ]}
        />
      </>
    );
  }

  function renderViewStatus(entry: PaletteEntry, slug: string) {
    const ctx = projectContext[slug];
    return (
      <>
        <Breadcrumb entry={entry} suffix="Status" />
        <div
          ref={actionsRef}
          tabIndex={0}
          className="space-y-2 p-3 text-sm focus:outline-none"
          onKeyDown={onViewStatusKeyDown}
        >
          {!ctx || ctx === "loading" ? (
            <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
              <Loader2 className="size-3.5 animate-spin" />
              Loading…
            </div>
          ) : "error" in ctx ? (
            <div className="text-destructive text-sm">{ctx.error}</div>
          ) : (
            <StatusSummary ctx={ctx} />
          )}
        </div>
        <PaletteFooter
          hints={[
            { keys: "↵", label: "open project" },
            { keys: "esc", label: "back" },
          ]}
        />
      </>
    );
  }

  function renderAttachZendeskForm(entry: PaletteEntry) {
    return (
      <>
        <Breadcrumb entry={entry} suffix={`Attach Zendesk ticket to ${entry.label}`} />
        <div className="space-y-2 p-3">
          <input
            ref={ticketRef}
            value={ticketInput}
            onChange={(e) => setTicketInput(e.target.value)}
            onKeyDown={(e) => onFormKeyDown(e, submitAttachZendesk)}
            disabled={submitting}
            placeholder="Ticket id or URL (e.g. 11134851)"
            className={cn(
              "border-input bg-background focus-visible:ring-ring",
              "w-full rounded-md border p-2 text-sm",
              "focus-visible:outline-none focus-visible:ring-1",
            )}
          />
          <p className="text-muted-foreground text-xs">
            Persists ticket id + subject/status (fetched on first render) into
            project frontmatter.
          </p>
        </div>
        <PaletteFooter
          hints={[
            { keys: "↵", label: submitting ? "saving…" : "attach" },
            { keys: "esc", label: "back" },
          ]}
        />
      </>
    );
  }

  function renderMarkTaskDonePick(entry: PaletteEntry, slug: string) {
    const ctx = projectContext[slug];
    const tasks = ctx && ctx !== "loading" && !("error" in ctx) ? ctx.open_tasks : [];
    return (
      <>
        <Breadcrumb entry={entry} suffix={`Mark task done in ${entry.label}`} />
        <div
          ref={actionsRef}
          tabIndex={0}
          className="max-h-[40vh] overflow-y-auto py-1 focus:outline-none"
          onKeyDown={(e) => onTaskPickKeyDown(e, tasks)}
        >
          {!ctx || ctx === "loading" ? (
            <div className="text-muted-foreground flex items-center gap-2 px-3 py-4 text-sm">
              <Loader2 className="size-3.5 animate-spin" />
              Loading tasks…
            </div>
          ) : "error" in ctx ? (
            <div className="text-destructive px-3 py-4 text-sm">{ctx.error}</div>
          ) : tasks.length === 0 ? (
            <div className="text-muted-foreground px-3 py-4 text-sm italic">
              No open tasks.
            </div>
          ) : (
            tasks.map((task, i) => (
              <button
                key={task.task_id}
                type="button"
                onClick={() => void submitMarkTaskDone(task.task_id, task.text)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
                  i === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
              >
                <CheckSquare className="size-4 shrink-0 opacity-70" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{task.text}</div>
                  {task.section ? (
                    <div className="text-muted-foreground truncate text-xs">
                      {task.section}
                    </div>
                  ) : null}
                </div>
              </button>
            ))
          )}
        </div>
        <PaletteFooter
          hints={[
            { keys: "↑↓", label: "navigate" },
            { keys: "↵", label: submitting ? "saving…" : "mark done" },
            { keys: "esc", label: "back" },
          ]}
        />
      </>
    );
  }

  function renderSnoozeForm(entry: PaletteEntry) {
    return (
      <>
        <Breadcrumb entry={entry} suffix="Snooze follow-up" />
        <div
          ref={actionsRef}
          tabIndex={0}
          className="max-h-[40vh] overflow-y-auto py-1 focus:outline-none"
          onKeyDown={onSnoozeKeyDown}
        >
          {SNOOZE_PRESETS.map((preset, i) => (
            <button
              key={preset.days}
              type="button"
              onClick={() => void submitSnoozeFollowUp(preset.days)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
                i === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50",
              )}
            >
              <Calendar className="size-4 shrink-0 opacity-70" />
              <span className="flex-1 truncate">{preset.label}</span>
            </button>
          ))}
        </div>
        <PaletteFooter
          hints={[
            { keys: "↑↓", label: "navigate" },
            { keys: "↵", label: submitting ? "saving…" : "snooze" },
            { keys: "esc", label: "back" },
          ]}
        />
      </>
    );
  }
}

function getEntry(step: Step): PaletteEntry {
  if (
    step.kind === "results" ||
    step.kind === "ai-interpreting" ||
    step.kind === "ai-error"
  ) {
    throw new Error("no entry on this step");
  }
  if (step.kind === "ai-confirm") {
    if (!step.entry) throw new Error("ai-confirm has no entry");
    return step.entry;
  }
  return step.entry;
}

function projectSlugForStep(step: Step): string | null {
  if (step.kind === "view-status" || step.kind === "mark-task-done-pick") {
    return step.projectSlug;
  }
  return null;
}

function defaultFollowUpDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 10);
}

const textareaClass = cn(
  "border-input bg-background focus-visible:ring-ring",
  "w-full resize-none rounded-md border p-2 text-sm",
  "focus-visible:outline-none focus-visible:ring-1",
);

function actionKey(action: PaletteAction): string {
  switch (action.kind) {
    case "navigate":
      return `navigate:${action.href}`;
    case "resolve-follow-up":
    case "snooze-follow-up":
      return `${action.kind}:${action.followUpId}`;
    default:
      return `${action.kind}:${action.projectSlug}`;
  }
}

function StatusSummary({ ctx }: { ctx: ProjectContext }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">Status</dt>
      <dd className="font-medium">{ctx.status}</dd>
      {ctx.priority ? (
        <>
          <dt className="text-muted-foreground">Priority</dt>
          <dd>{ctx.priority}</dd>
        </>
      ) : null}
      <dt className="text-muted-foreground">Kind</dt>
      <dd>{ctx.kind}</dd>
      {ctx.partner ? (
        <>
          <dt className="text-muted-foreground">Partner</dt>
          <dd>{ctx.partner}</dd>
        </>
      ) : null}
      <dt className="text-muted-foreground">Open tasks</dt>
      <dd>{ctx.open_tasks.length}</dd>
      <dt className="text-muted-foreground">Open follow-ups</dt>
      <dd>{ctx.open_followups_count}</dd>
      <dt className="text-muted-foreground">Zendesk tickets</dt>
      <dd>{ctx.zendesk_ticket_count}</dd>
      <dt className="text-muted-foreground">Last touched</dt>
      <dd className="text-xs">{ctx.modified_at.slice(0, 10)}</dd>
    </dl>
  );
}

function AiOptionRow({
  query,
  selected,
  onClick,
}: {
  query: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-row-index={0}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      <Sparkles className="size-4 shrink-0 opacity-70" />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          Ask Smithers: <span className="italic">{query}</span>
        </div>
        <div className="text-muted-foreground truncate text-xs">
          Free-form query → propose an action → confirm
        </div>
      </div>
      <span className="text-muted-foreground bg-muted shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
        AI
      </span>
    </button>
  );
}

function ResultRow({
  entry,
  selected,
  rowIndex,
  onClick,
}: {
  entry: PaletteEntry;
  selected: boolean;
  rowIndex: number;
  onClick: () => void;
}) {
  const Icon = iconForKind(entry.kind);
  return (
    <button
      type="button"
      data-row-index={rowIndex}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      <Icon className="size-4 shrink-0 opacity-70" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{entry.label}</div>
        {entry.description ? (
          <div className="text-muted-foreground truncate text-xs">
            {entry.description}
          </div>
        ) : null}
      </div>
      <KindBadge kind={entry.kind} />
    </button>
  );
}

function ActionRow({
  action,
  selected,
  onClick,
}: {
  action: PaletteAction;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = iconForAction(action.kind);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      <Icon className="size-4 shrink-0 opacity-70" />
      <span className="flex-1 truncate">{action.label}</span>
      {action.kind === "navigate" ? (
        <ExternalLink className="text-muted-foreground size-3.5" />
      ) : null}
    </button>
  );
}

function Breadcrumb({
  entry,
  suffix,
}: {
  entry: PaletteEntry;
  suffix?: string;
}) {
  const Icon = iconForKind(entry.kind);
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 border-b px-3 py-2 text-xs">
      <Icon className="size-3.5" />
      <span className="text-foreground truncate font-medium">{entry.label}</span>
      {suffix ? (
        <>
          <ChevronRight className="size-3" />
          <span className="truncate">{suffix}</span>
        </>
      ) : null}
    </div>
  );
}

function PaletteFooter({
  hints,
}: {
  hints: Array<{ keys: string; label: string }>;
}) {
  return (
    <div className="text-muted-foreground flex items-center gap-3 border-t bg-muted/30 px-3 py-1.5 text-[10px]">
      {hints.map((h) => (
        <span key={h.keys} className="flex items-center gap-1">
          <KeyboardHint label={h.keys} />
          {h.label}
        </span>
      ))}
    </div>
  );
}

function KeyboardHint({ label }: { label: string }) {
  return (
    <kbd className="bg-muted text-muted-foreground rounded px-1 py-0.5 font-mono text-[10px]">
      {label}
    </kbd>
  );
}

function KindBadge({ kind }: { kind: PaletteEntryKind }) {
  const label = KIND_LABEL[kind];
  return (
    <span className="text-muted-foreground bg-muted shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
      {label}
    </span>
  );
}

const KIND_LABEL: Record<PaletteEntryKind, string> = {
  "project-vault": "Project",
  "partner-hm": "Partner",
  "project-hm": "HM",
  page: "Page",
  "follow-up": "Follow-up",
};

function iconForKind(kind: PaletteEntryKind) {
  switch (kind) {
    case "project-vault":
      return FolderKanban;
    case "partner-hm":
      return Users;
    case "project-hm":
      return Sparkles;
    case "page":
      return FileText;
    case "follow-up":
      return Inbox;
  }
}

function hintForNavOnly(kind: PaletteEntryKind): string {
  switch (kind) {
    case "page":
      return "Pages just navigate. Pick a project from search to add tasks, follow-ups, or set status.";
    case "partner-hm":
      return "Partner pages just navigate. Pick a vault project tied to this partner to take action on it.";
    case "project-hm":
      return "This project lives only in Hive Mind — link it to a vault project to add tasks, follow-ups, etc.";
    default:
      return "Pick a project from search to take action on it.";
  }
}

function iconForAction(kind: PaletteAction["kind"]) {
  switch (kind) {
    case "navigate":
      return ArrowRight;
    case "add-task":
      return Plus;
    case "add-followup":
      return Inbox;
    case "set-status":
      return Tag;
    case "view-status":
      return ListChecks;
    case "attach-zendesk":
      return Ticket;
    case "mark-task-done":
      return CheckSquare;
    case "resolve-follow-up":
      return CheckSquare;
    case "snooze-follow-up":
      return CircleSlash;
  }
}
