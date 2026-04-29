"use client";

import { Loader2, Pin, PinOff, X } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  demoteTop3Action,
  pinTop3Action,
  unpinTop3Action,
} from "@/app/today/actions";
import { Button } from "@/components/ui/button";

interface Props {
  candidateId: string;
  pinned: boolean;
  /** Used in the toast confirmation. */
  label?: string;
}

/**
 * Per-row pin / demote controls for Top 3 cards. Shows a pin icon (or
 * pin-off when already pinned) and a small × for "demote, don't show in
 * Top 3 today". Both call server actions that revalidate /today.
 */
export function Top3RowActions({ candidateId, pinned, label }: Props) {
  const [pending, startTransition] = useTransition();

  function pin() {
    startTransition(async () => {
      try {
        if (pinned) {
          await unpinTop3Action(candidateId);
          toast.success(label ? `Unpinned ${label}` : "Unpinned");
        } else {
          await pinTop3Action(candidateId);
          toast.success(label ? `Pinned ${label}` : "Pinned");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  function demote() {
    startTransition(async () => {
      try {
        await demoteTop3Action(candidateId);
        toast.success(
          label ? `Demoted ${label}` : "Removed from Top 3",
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-6 w-6 p-0"
        onClick={pin}
        disabled={pending}
        title={pinned ? "Unpin from Top 3" : "Pin to Top 3"}
        aria-label={pinned ? "Unpin from Top 3" : "Pin to Top 3"}
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : pinned ? (
          <PinOff className="size-3" />
        ) : (
          <Pin className="size-3" />
        )}
      </Button>
      {!pinned ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-6 w-6 p-0"
          onClick={demote}
          disabled={pending}
          title="Remove from Top 3 today"
          aria-label="Demote from Top 3"
        >
          <X className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}
