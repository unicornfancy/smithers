"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import type { DraftZendeskReplyOutput } from "@smithers/agents";

import { draftZendeskReplyAction } from "@/app/projects/[slug]/actions";
import { AiDraftDialog } from "@/components/ai-draft-dialog";
import { Button } from "@/components/ui/button";

interface Props {
  projectSlug: string;
  ticketId: string;
  /** Subject (when known) used as dialog title context. */
  ticketSubject?: string | null;
}

/**
 * Inline "Draft reply" button on each Zendesk thread card. Calls the
 * draft-zendesk-reply agent and opens an editable dialog with the
 * generated reply + tone + rationale + Copy.
 */
export function DraftZendeskReplyButton({
  projectSlug,
  ticketId,
  ticketSubject,
}: Props) {
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<DraftZendeskReplyOutput | null>(null);

  function run() {
    startTransition(async () => {
      try {
        const r = await draftZendeskReplyAction(projectSlug, ticketId);
        if (r.ok) {
          setData(r.data);
          setOpen(true);
        } else if (r.reason === "not-configured") {
          toast.error(
            "Set ANTHROPIC_API_KEY in .env.local to enable AI drafts",
          );
        } else {
          toast.error(r.message ?? "Couldn't draft reply");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't draft reply",
        );
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={run}
        disabled={pending}
        title="Draft a reply for this thread"
        className="h-6 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Sparkles className="size-3" />
        )}
        Draft reply
      </Button>
      <AiDraftDialog
        open={open}
        onOpenChange={setOpen}
        title={`Draft for #${ticketId}${ticketSubject ? ` — ${truncate(ticketSubject, 50)}` : ""}`}
        meta={data ? `${data.tone} tone` : ""}
        rationale={data?.rationale ?? ""}
        body={data?.draft ?? ""}
      />
    </>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
