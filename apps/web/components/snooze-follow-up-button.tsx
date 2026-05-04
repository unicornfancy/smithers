"use client";

import { CalendarClock, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { snoozeFollowUpAction } from "@/app/projects/[slug]/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface Props {
  projectSlug: string;
  followUpId: string;
  /** Truncated task text used in the success toast. */
  label: string;
  /** Stay visible (vs. hover-only) — used when a stall hint applies. */
  alwaysVisible?: boolean;
}

const PRESETS: { days: number; label: string }[] = [
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
];

/**
 * Push a follow-up's `Follow-up By` date forward without marking it
 * resolved. Hover-only by default to match the Resolve button rhythm;
 * stays visible while pending so the user sees the spinner.
 */
export function SnoozeFollowUpButton({
  projectSlug,
  followUpId,
  label,
  alwaysVisible = false,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleSnooze(days: number, presetLabel: string) {
    startTransition(async () => {
      try {
        const r = await snoozeFollowUpAction(projectSlug, followUpId, days);
        if (r.changed) {
          toast.success(
            `Snoozed ${presetLabel}: ${truncate(label, 40)} (now due ${r.follow_up_by})`,
          );
        } else {
          toast.info(`Already due ${r.follow_up_by}`);
        }
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't snooze follow-up",
        );
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          title="Snooze"
          aria-label={`Snooze: ${truncate(label, 60)}`}
          className={cn(
            "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded",
            "text-muted-foreground hover:text-sky-600 hover:bg-sky-500/10",
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
            <CalendarClock className="size-3.5" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        <DropdownMenuLabel className="text-xs">Snooze for</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PRESETS.map((p) => (
          <DropdownMenuItem
            key={p.days}
            onSelect={() => handleSnooze(p.days, p.label)}
            disabled={pending}
            className="text-xs"
          >
            {p.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
