"use client";

import { CheckCircle2, Loader2, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { FollowUp } from "@smithers/vault";

import {
  deleteFollowUpAction,
  resolveFollowUpAction,
} from "@/app/projects/[slug]/actions";
import { EditFollowUpForm } from "@/components/edit-follow-up-form";
import { cn } from "@/lib/utils";

interface Props {
  followUp: FollowUp;
  showCompose?: boolean;
  composeSlot?: React.ReactNode;
}

/**
 * Wraps a single active follow-up row on /follow-ups with an Edit toggle.
 * The row and the inline form share the same `<tr>` boundary so the table
 * layout stays stable (the form replaces the row cells rather than
 * inserting a new row).
 *
 * Active rows get an Edit button in the last column; clicking it expands
 * the inline EditFollowUpForm in place of the data cells.
 */
export function EditableFollowUpRow({ followUp, showCompose, composeSlot }: Props) {
  const [editing, setEditing] = useState(false);
  const [resolving, startResolveTransition] = useTransition();
  const [deleting, startDeleteTransition] = useTransition();
  const router = useRouter();

  function handleResolve() {
    startResolveTransition(async () => {
      try {
        const r = await resolveFollowUpAction("", followUp.follow_up_id);
        if (r.changed) {
          toast.success(`Marked complete: ${truncate(followUp.task, 50)}`);
        } else {
          toast.info("Already resolved");
        }
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't mark complete",
        );
      }
    });
  }

  function handleDelete() {
    // Confirm — delete drops the row from Follow-ups.md entirely and
    // (unlike resolve) leaves no audit trail in the file.
    const ok = window.confirm(
      `Delete this follow-up?\n\n"${truncate(followUp.task, 80)}"\n\nThis removes the row from Follow-ups.md — there's no undo.`,
    );
    if (!ok) return;
    startDeleteTransition(async () => {
      const r = await deleteFollowUpAction("", followUp.follow_up_id);
      if (r.ok) {
        toast.success(
          r.deleted ? "Deleted" : "Row had already been removed",
        );
        router.refresh();
      } else {
        toast.error(r.message ?? "Couldn't delete follow-up");
      }
    });
  }

  const statusEl = (
    <span
      className={
        followUp.status === "escalated"
          ? "text-amber-700 dark:text-amber-400"
          : "text-foreground"
      }
    >
      {followUp.status === "escalated" ? "escalated" : "waiting"}
    </span>
  );

  if (editing) {
    return (
      <tr className="border-b last:border-0">
        <td colSpan={showCompose ? 6 : 5} className="py-2 pr-4 align-top">
          <div className="text-xs font-medium text-muted-foreground mb-1">
            {followUp.project}
          </div>
          <EditFollowUpForm
            followUp={followUp}
            onDone={() => setEditing(false)}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-muted/40 border-b last:border-0 group">
      <td className="py-2 pr-4 align-top text-xs font-medium">
        {followUp.project}
      </td>
      <td className="py-2 pr-4 align-top">
        <div className="flex flex-col gap-0.5">
          <p className="leading-snug">{followUp.task}</p>
          {followUp.status_note ? (
            <p className="text-muted-foreground text-xs leading-snug">
              {followUp.status_note}
            </p>
          ) : null}
        </div>
      </td>
      <td className="text-muted-foreground py-2 pr-4 align-top tabular-nums">
        {followUp.sent}
      </td>
      <td className="text-muted-foreground py-2 pr-4 align-top tabular-nums">
        {followUp.follow_up_by ?? "—"}
      </td>
      <td className="py-2 pr-4 align-top">{statusEl}</td>
      <td className="py-2 align-top">
        <div className="flex items-center gap-1">
          {showCompose && composeSlot ? composeSlot : null}
          <button
            type="button"
            onClick={handleResolve}
            disabled={resolving || deleting}
            title="Mark complete (keeps audit trail in Follow-ups.md)"
            aria-label={`Mark complete: ${followUp.task}`}
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded",
              "text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
              resolving && "opacity-100",
            )}
          >
            {resolving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={resolving || deleting}
            title="Edit follow-up"
            aria-label={`Edit follow-up: ${followUp.task}`}
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded",
              "text-muted-foreground hover:text-foreground hover:bg-muted",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
            )}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={resolving || deleting}
            title="Delete (removes from Follow-ups.md — no audit trail)"
            aria-label={`Delete follow-up: ${followUp.task}`}
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded",
              "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
              deleting && "opacity-100",
            )}
          >
            {deleting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </button>
        </div>
      </td>
    </tr>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
