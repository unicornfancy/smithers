"use client";

import * as React from "react";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { SummarizeZendeskThreadOutput } from "@smithers/agents";

import { summarizeZendeskThreadAction } from "@/app/projects/[slug]/actions";
import { AiDraftDialog } from "@/components/ai-draft-dialog";
import { Button } from "@/components/ui/button";

interface Props {
  projectSlug: string;
  ticketId: string;
  /** Subject (when known) used as dialog title context. */
  ticketSubject?: string | null;
}

/**
 * Inline "Summarize" button on each Zendesk thread row. One click runs
 * the summarize-zendesk-thread agent and opens the AiDraftDialog with
 * the result — copy-only, no save-as-draft. Quick read-only triage tool.
 */
export function SummarizeZendeskThreadButton({
  projectSlug,
  ticketId,
  ticketSubject,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [data, setData] = React.useState<SummarizeZendeskThreadOutput | null>(
    null,
  );

  function run() {
    if (pending) return;
    setData(null);
    setOpen(true);
    startTransition(async () => {
      try {
        const r = await summarizeZendeskThreadAction(projectSlug, ticketId);
        if (r.ok) {
          setData(r.data);
        } else if (r.reason === "not-configured") {
          toast.error(
            "Set ANTHROPIC_API_KEY in .env.local to enable AI summaries",
          );
          setOpen(false);
        } else {
          toast.error(r.message ?? "Couldn't summarize thread");
          setOpen(false);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't summarize thread",
        );
        setOpen(false);
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
        title="Summarize this Zendesk thread"
        className="h-6 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <FileText className="size-3" />
        )}
        Summarize
      </Button>
      <AiDraftDialog
        open={open}
        onOpenChange={setOpen}
        title={`Summary for #${ticketId}${ticketSubject ? ` — ${truncate(ticketSubject, 50)}` : ""}`}
        meta={
          pending
            ? "Generating summary…"
            : data?.next_step
              ? `Next: ${data.next_step}`
              : ""
        }
        rationale=""
        body={pending ? "" : (data?.summary ?? "")}
      />
    </>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
