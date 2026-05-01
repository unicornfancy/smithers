"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { resolveFollowUpAction } from "@/app/projects/[slug]/actions";
import { cn } from "@/lib/utils";

interface Props {
  projectSlug: string;
  followUpId: string;
  /** Truncated task text used in the success toast. */
  label: string;
  /** Stay visible (vs. hover-only) — used when a stall hint applies. */
  alwaysVisible?: boolean;
}

/**
 * Mark a follow-up resolved without leaving the workbench. Hover-only
 * by default (parent <li> has `group`); becomes always-visible while
 * the action is pending so the user can see the state change.
 */
export function ResolveFollowUpButton({
  projectSlug,
  followUpId,
  label,
  alwaysVisible = false,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const r = await resolveFollowUpAction(projectSlug, followUpId);
        if (r.changed) {
          toast.success(`Resolved: ${truncate(label, 50)}`);
        } else {
          toast.info("Already resolved");
        }
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't resolve follow-up",
        );
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title="Mark resolved"
      aria-label={`Mark resolved: ${truncate(label, 60)}`}
      className={cn(
        "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded",
        "text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "transition-opacity",
        alwaysVisible
          ? "opacity-70 hover:opacity-100"
          : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        pending && "opacity-100",
      )}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <CheckCircle2 className="size-3.5" />
      )}
    </button>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
