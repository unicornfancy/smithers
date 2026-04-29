"use client";

import { Loader2, X } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { dismissPingAction } from "@/app/today/actions";
import { Button } from "@/components/ui/button";

interface Props {
  pingId: string;
  /** Short label for the toast — usually the actor name. */
  label?: string;
}

export function DismissPingButton({ pingId, label }: Props) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        await dismissPingAction(pingId);
        toast.success(label ? `Dismissed ${label}` : "Dismissed");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to dismiss",
        );
      }
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground h-6 w-6 shrink-0 p-0"
      onClick={handleClick}
      disabled={pending}
      title="Dismiss this ping"
      aria-label="Dismiss ping"
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <X className="size-3" />
      )}
    </Button>
  );
}
