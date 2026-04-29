"use client";

import { Loader2, Undo2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { undoActionEntry } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import type {
  ActionKind,
  EntityType,
} from "@/lib/server/user-actions";

interface Props {
  entityType: EntityType;
  entityId: string;
  action: ActionKind;
}

export function UndoActionButton({ entityType, entityId, action }: Props) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        await undoActionEntry(entityType, entityId, action);
        toast.success("Undone");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to undo",
        );
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
      title="Undo this action"
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Undo2 className="size-3" />
      )}
      Undo
    </Button>
  );
}
