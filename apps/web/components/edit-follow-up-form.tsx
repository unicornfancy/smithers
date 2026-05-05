"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { FollowUp } from "@smithers/vault";

import { updateFollowUpAction } from "@/app/projects/[slug]/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 disabled:opacity-60";

interface Props {
  followUp: FollowUp;
  /** When the form is cancelled or saved, signal the parent to hide it. */
  onDone: () => void;
}

/**
 * Inline (non-modal) edit form for a single follow-up row on /follow-ups.
 * Uses useTransition + router.refresh() to stay consistent with every
 * other action component in this codebase.
 */
export function EditFollowUpForm({ followUp, onDone }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [task, setTask] = useState(followUp.task);
  const [sent, setSent] = useState(followUp.sent ?? "");
  const [followUpBy, setFollowUpBy] = useState(followUp.follow_up_by ?? "");
  const [status, setStatus] = useState<"waiting" | "escalated">(
    followUp.status === "escalated" ? "escalated" : "waiting",
  );

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const r = await updateFollowUpAction(
          "", // no projectSlug context on the /follow-ups page
          followUp.follow_up_id,
          {
            task: task || undefined,
            sent: sent || undefined,
            follow_up_by: followUpBy, // empty string clears the cell
            status,
          },
        );
        if (!r.ok) {
          toast.error(r.message ?? "Couldn't save changes");
          return;
        }
        if (r.changed) {
          toast.success("Follow-up updated");
        } else {
          toast.info("No changes");
        }
        router.refresh();
        onDone();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't save changes",
        );
      }
    });
  }

  return (
    <form
      onSubmit={handleSave}
      className="bg-muted/40 mt-1 flex flex-col gap-3 rounded-md border p-3"
    >
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`ef-task-${followUp.follow_up_id}`}
          className="text-muted-foreground text-xs font-medium"
        >
          Task
        </label>
        <textarea
          id={`ef-task-${followUp.follow_up_id}`}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={2}
          disabled={pending}
          className={cn(
            inputClass,
            "h-auto py-2 resize-none",
          )}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`ef-sent-${followUp.follow_up_id}`}
            className="text-muted-foreground text-xs font-medium"
          >
            Sent date
          </label>
          <input
            id={`ef-sent-${followUp.follow_up_id}`}
            type="date"
            value={sent}
            onChange={(e) => setSent(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`ef-fub-${followUp.follow_up_id}`}
            className="text-muted-foreground text-xs font-medium"
          >
            Follow-up by
          </label>
          <input
            id={`ef-fub-${followUp.follow_up_id}`}
            type="date"
            value={followUpBy}
            onChange={(e) => setFollowUpBy(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`ef-status-${followUp.follow_up_id}`}
          className="text-muted-foreground text-xs font-medium"
        >
          Status
        </label>
        <select
          id={`ef-status-${followUp.follow_up_id}`}
          value={status}
          onChange={(e) => setStatus(e.target.value as "waiting" | "escalated")}
          disabled={pending}
          className={inputClass}
        >
          <option value="waiting">Waiting</option>
          <option value="escalated">Escalated</option>
        </select>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDone}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : null}
          Save
        </Button>
      </div>
    </form>
  );
}
