"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { editProjectTaskTextAction } from "@/app/projects/[slug]/actions";
import { cn } from "@/lib/utils";

interface Props {
  projectSlug: string;
  taskId: string;
  text: string;
  /** Apply line-through styling for done tasks (suppressed during edit). */
  dim?: boolean;
}

/**
 * Click-to-edit task text. View mode is a button that looks like text;
 * edit mode swaps in an inline input. Enter or blur saves; Esc cancels;
 * empty/whitespace is treated as cancel rather than as an implicit delete.
 *
 * task_id is text-derived, so a successful save changes it. revalidatePath
 * triggers a re-render with the new id; React keys the row by id, so the
 * row remounts cleanly with the new value as its prop default.
 */
export function EditableTaskText({
  projectSlug,
  taskId,
  text,
  dim = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  // Hold off on save attempts triggered by the implicit blur that happens
  // when we programmatically unmount the input on Esc. Without this, Esc
  // would cancel-then-save with whatever was typed.
  const cancelledRef = useRef(false);

  function commit(next: string) {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const trimmed = next.trim();
    if (!trimmed || trimmed === text) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      try {
        await editProjectTaskTextAction(projectSlug, taskId, trimmed);
        setEditing(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't save task",
        );
        setEditing(false);
      }
    });
  }

  if (editing) {
    return (
      <input
        type="text"
        defaultValue={text}
        autoFocus
        disabled={pending}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancelledRef.current = true;
            setEditing(false);
          } else if (e.key === "Enter") {
            e.preventDefault();
            commit(e.currentTarget.value);
          }
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
        className={cn(
          "border-input bg-background focus-visible:ring-ring",
          "w-full rounded border px-1.5 py-0.5 text-sm leading-snug",
          "focus-visible:outline-none focus-visible:ring-1",
          "disabled:opacity-60",
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "w-full cursor-text rounded px-1.5 py-0.5 -mx-1.5 text-left text-sm leading-snug",
        "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
        dim && "line-through",
      )}
      title="Click to edit"
    >
      {text}
    </button>
  );
}
