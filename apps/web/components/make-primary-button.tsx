"use client";

import { Loader2, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setPrimaryZendeskTicketAction } from "@/app/projects/[slug]/actions";
import { Button } from "@/components/ui/button";

interface Props {
  projectSlug: string;
  ticketId: string;
  /** Short label used in the success toast. */
  ticketLabel: string;
}

/**
 * Promotes a Zendesk ticket to primary on the project workbench. The
 * Zendesk panel keys "primary" off position 0 in the frontmatter array,
 * so this server action just reorders.
 */
export function MakePrimaryButton({
  projectSlug,
  ticketId,
  ticketLabel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const r = await setPrimaryZendeskTicketAction(projectSlug, ticketId);
        if (r.changed) {
          toast.success(`Promoted ${ticketLabel} to primary`);
        } else {
          toast.info(`${ticketLabel} was already primary`);
        }
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't change primary",
        );
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={handleClick}
      title="Make this the primary thread"
      className="h-6 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Star className="size-3" />
      )}
      Make primary
    </Button>
  );
}
