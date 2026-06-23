"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import type { ComposeNudgeOutput } from "@smithers/agents";
import type { ContextItem } from "@smithers/mcp-client";

import { composeFollowUpNudgeAction } from "@/app/projects/[slug]/actions";
import { AiDraftDialog } from "@/components/ai-draft-dialog";
import { Button } from "@/components/ui/button";
import { DraftContextPickerDialog } from "@/components/draft-context-picker-dialog";

interface Props {
  projectSlug: string;
  followUpId: string;
  /** Truncated task text used in the dialog header. */
  label: string;
}

/**
 * Inline "Draft nudge" button on each follow-up row. Phase H flow:
 *   click → ContextPicker dialog → user clicks Generate →
 *   compose-followup-nudge runs with curated extra_context →
 *   AiDraftDialog opens with the generated nudge.
 */
export function DraftFollowUpNudgeButton({
  projectSlug,
  followUpId,
  label,
}: Props) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [data, setData] = React.useState<ComposeNudgeOutput | null>(null);
  const [lastContext, setLastContext] = React.useState<ContextItem[]>([]);

  function runWithContext(items: ContextItem[], intent: string) {
    if (pending) return;
    setLastContext(items);
    startTransition(async () => {
      try {
        const r = await composeFollowUpNudgeAction(
          projectSlug,
          followUpId,
          items,
          intent || undefined,
        );
        if (r.ok) {
          setData(r.data);
          setPickerOpen(false);
          setDraftOpen(true);
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

  async function regenerate() {
    if (pending) return;
    await new Promise<void>((resolve) =>
      startTransition(async () => {
        try {
          const r = await composeFollowUpNudgeAction(
            projectSlug,
            followUpId,
            lastContext,
          );
          if (r.ok) {
            setData(r.data);
          } else if (r.reason === "not-configured") {
            toast.error(
              "Set ANTHROPIC_API_KEY in .env.local to enable AI drafts",
            );
          } else {
            toast.error(r.message ?? "Couldn't regenerate");
          }
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Couldn't regenerate",
          );
        } finally {
          resolve();
        }
      }),
    );
  }

  function changeContext() {
    setDraftOpen(false);
    setPickerOpen(true);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setPickerOpen(true)}
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
      <DraftContextPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={`Draft nudge for: ${truncate(label, 60)}`}
        projectSlug={projectSlug}
        onGenerate={runWithContext}
        busy={pending}
      />
      <AiDraftDialog
        open={draftOpen}
        onOpenChange={setDraftOpen}
        title={`Drafted nudge for: ${truncate(label, 60)}`}
        meta={
          data
            ? `${data.channel === "email" ? "Email" : "Slack"} · ${data.tone} tone`
            : ""
        }
        rationale={data?.rationale ?? ""}
        subject={data?.channel === "email" ? data.subject : undefined}
        body={data?.draft ?? ""}
        onRegenerate={regenerate}
        onChangeContext={changeContext}
        regenerating={pending}
        saveAsDraft={
          data
            ? {
                suggestedTitle: `Nudge — ${truncate(label, 60)}`,
                projectSlug,
                sourceAgent: "compose-followup-nudge",
                channel: data.channel,
              }
            : undefined
        }
      />
    </>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
