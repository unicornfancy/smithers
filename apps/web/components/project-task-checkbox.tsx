"use client";

import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { toggleProjectTaskAction } from "@/app/projects/[slug]/actions";
import { cn } from "@/lib/utils";

interface Props {
  projectSlug: string;
  taskId: string;
  done: boolean;
  /** Short text used in the failure toast so the user knows which task. */
  label: string;
}

/**
 * A single checkbox that toggles the underlying markdown line in the vault
 * file. Optimistic so the UI flips instantly; rolls back + toasts on error.
 */
export function ProjectTaskCheckbox({
  projectSlug,
  taskId,
  done,
  label,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [optimisticDone, setOptimisticDone] = useOptimistic(done);

  function handleClick() {
    const next = !optimisticDone;
    startTransition(async () => {
      setOptimisticDone(next);
      try {
        await toggleProjectTaskAction(projectSlug, taskId, next);
      } catch (err) {
        toast.error(
          `Couldn't update "${truncate(label, 40)}": ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        );
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-pressed={optimisticDone}
      aria-label={
        optimisticDone ? "Mark task as not done" : "Mark task as done"
      }
      className={cn(
        "mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full",
        "text-muted-foreground hover:text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        pending && "opacity-60",
      )}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : optimisticDone ? (
        <CheckCircle2 className="size-3.5" />
      ) : (
        <Circle className="size-3.5" />
      )}
    </button>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
