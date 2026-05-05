"use client";

import { ClipboardCheck, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { convertFollowUpToTaskAction } from "@/app/projects/[slug]/actions";
import { cn } from "@/lib/utils";

interface Props {
  projectSlug: string;
  followUpId: string;
  /** Truncated task text used in the success toast. */
  label: string;
}

/**
 * One-click: resolve the follow-up and append a new open task to the project.
 * No dialog needed — the action is reversible (task can be deleted, follow-up
 * already has its status flipped).
 */
export function ConvertFollowUpToTaskButton({
  projectSlug,
  followUpId,
  label,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const r = await convertFollowUpToTaskAction(projectSlug, followUpId);
        if (r.ok) {
          toast.success(`Moved to to-dos: ${truncate(label, 50)}`);
          router.refresh();
        } else {
          toast.error(r.message ?? "Conversion failed");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't convert follow-up",
        );
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title="Convert to to-do"
      aria-label={`Convert to to-do: ${truncate(label, 60)}`}
      className={cn(
        "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded",
        "text-muted-foreground hover:text-violet-600 hover:bg-violet-500/10",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        pending && "opacity-100",
      )}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <ClipboardCheck className="size-3.5" />
      )}
    </button>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
