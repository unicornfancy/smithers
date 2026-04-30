"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { deleteProjectTaskAction } from "@/app/projects/[slug]/actions";
import { cn } from "@/lib/utils";

interface Props {
  projectSlug: string;
  taskId: string;
  /** Truncated task text used in the failure toast for context. */
  label: string;
}

/**
 * Hover-only trash button on each Open Items row. Click runs the delete
 * server action; revalidatePath repaints the panel without the row. We
 * deliberately don't confirm — the file is in git and editable in Obsidian,
 * and the row briefly shows a spinner so the click feels intentional.
 */
export function DeleteProjectTaskButton({ projectSlug, taskId, label }: Props) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        await deleteProjectTaskAction(projectSlug, taskId);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't delete task",
        );
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={`Delete task: ${truncate(label, 60)}`}
      title="Delete task"
      className={cn(
        "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded",
        "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "transition-opacity",
        pending && "opacity-100",
      )}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Trash2 className="size-3.5" />
      )}
    </button>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
