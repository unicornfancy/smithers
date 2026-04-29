"use client";

import { Check, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { acceptStallAction } from "@/app/today/actions";
import { Button } from "@/components/ui/button";

interface Props {
  stallId: string;
  /** Short label for the toast — usually the row title. */
  label?: string;
}

/**
 * "I've made my decision: this is going to sit." Records an "accept"
 * action against the stall, drops it from /today's Stalls card +
 * project workbench Needs Decision panel + Top 3 candidate scoring.
 * The underlying follow-up row is left visible on /follow-ups so the
 * user can flip the decision later.
 */
export function AcceptStallButton({ stallId, label }: Props) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        await acceptStallAction(stallId);
        toast.success(label ? `Accepted: ${label}` : "Stall accepted");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
      onClick={handleClick}
      disabled={pending}
      title="Accept stall — stop surfacing this on Today and Top 3"
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Check className="size-3" />
      )}
      Accept
    </Button>
  );
}
