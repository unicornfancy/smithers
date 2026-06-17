"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { createLinkedFollowUpAction } from "@/app/projects/[slug]/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  projectSlug: string;
  /** Display name written to the Project column in Follow-ups.md. */
  projectName: string;
  /** Default lookahead (days) for the follow_up_by field, from config.follow_ups.default_window_days. */
  defaultWindowDays: number;
}

/**
 * Inline "Add follow-up" form rendered at the bottom of the workbench
 * panel. Folded into a small button by default; expands to a compact
 * three-field form (task, sent date, follow-up-by date) on click.
 *
 * Writes via `createLinkedFollowUpAction` so the row gets the same
 * source-linkage shape used by Zendesk / GitHub "Watch for reply"
 * follow-ups — no source_type for ad-hoc workbench rows.
 */
export function AddProjectFollowUpForm({
  projectSlug,
  projectName,
  defaultWindowDays,
}: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [task, setTask] = React.useState("");
  const [followUpBy, setFollowUpBy] = React.useState(() =>
    isoPlusDays(defaultWindowDays),
  );
  const [sent, setSent] = React.useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  function reset() {
    setTask("");
    setSent(new Date().toISOString().slice(0, 10));
    setFollowUpBy(isoPlusDays(defaultWindowDays));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = task.trim();
    if (!trimmed) {
      toast.error("Task is required");
      return;
    }
    setPending(true);
    try {
      const res = await createLinkedFollowUpAction(projectSlug, {
        project: projectName,
        task: trimmed,
        sent: sent || undefined,
        follow_up_by: followUpBy || undefined,
      });
      if (!res.ok) {
        toast.error(res.message ?? res.reason);
        return;
      }
      toast.success("Follow-up added");
      reset();
      setExpanded(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (!expanded) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(true)}
        className="text-muted-foreground hover:text-foreground -ml-2 gap-1.5 text-xs"
      >
        <Plus className="size-3.5" />
        Add follow-up
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-muted/30 rounded-md border p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
          New follow-up
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setExpanded(false)}
          aria-label="Cancel"
          disabled={pending}
          className="size-6"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <input
        type="text"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="What are you waiting on?"
        disabled={pending}
        className={cn(
          "border-input bg-background focus-visible:ring-ring",
          "mt-1.5 w-full rounded-md border px-2 py-1 text-sm",
          "focus-visible:outline-none focus-visible:ring-1",
        )}
        autoFocus
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <DateField
          label="Sent"
          value={sent}
          onChange={setSent}
          disabled={pending}
        />
        <DateField
          label="Follow-up by"
          value={followUpBy}
          onChange={setFollowUpBy}
          disabled={pending}
        />
        <Button
          type="submit"
          size="sm"
          disabled={pending || !task.trim()}
          className="ml-auto gap-1.5"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
          Add
        </Button>
      </div>
    </form>
  );
}

function DateField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
      <span>{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          "border-input bg-background focus-visible:ring-ring",
          "rounded-md border px-1.5 py-0.5 text-xs tabular-nums text-foreground",
          "focus-visible:outline-none focus-visible:ring-1",
        )}
      />
    </label>
  );
}

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}
