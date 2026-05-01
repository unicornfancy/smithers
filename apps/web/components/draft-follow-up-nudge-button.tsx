"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import type { ComposeNudgeOutput } from "@smithers/agents";

import { composeFollowUpNudgeAction } from "@/app/projects/[slug]/actions";
import { AiDraftDialog } from "@/components/ai-draft-dialog";
import { Button } from "@/components/ui/button";

interface Props {
  projectSlug: string;
  followUpId: string;
  /** Truncated task text used in the dialog header. */
  label: string;
}

/**
 * Inline "Draft nudge" button on each follow-up row. Calls the
 * compose-followup-nudge agent and opens an editable dialog with the
 * generated draft + rationale + Copy button.
 */
export function DraftFollowUpNudgeButton({
  projectSlug,
  followUpId,
  label,
}: Props) {
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<ComposeNudgeOutput | null>(null);

  function run() {
    startTransition(async () => {
      try {
        const r = await composeFollowUpNudgeAction(projectSlug, followUpId);
        if (r.ok) {
          setData(r.data);
          setOpen(true);
        } else if (r.reason === "not-configured") {
          toast.error(
            "Set ANTHROPIC_API_KEY in .env.local to enable AI drafts",
          );
        } else {
          toast.error(r.message ?? "Couldn't compose nudge");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't compose nudge",
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
        title="Draft a nudge for this follow-up"
        className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Sparkles className="size-3" />
        )}
        Draft nudge
      </Button>
      <AiDraftDialog
        open={open}
        onOpenChange={setOpen}
        title={`Drafted nudge for: ${truncate(label, 60)}`}
        meta={
          data
            ? `${data.channel === "email" ? "Email" : "Slack"} · ${data.tone} tone`
            : ""
        }
        rationale={data?.rationale ?? ""}
        subject={data?.channel === "email" ? data.subject : undefined}
        body={data?.draft ?? ""}
      />
    </>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
