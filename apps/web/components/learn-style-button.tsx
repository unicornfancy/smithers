"use client";

import * as React from "react";
import { GraduationCap, Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { LearnStyleFromArchivesOutput } from "@smithers/agents";

import { learnStyleFromArchivesAction } from "@/app/drafts/actions";
import { AiDraftDialog } from "@/components/ai-draft-dialog";
import { Button } from "@/components/ui/button";

/**
 * Trigger the learn-style-from-archives agent over recent
 * archived-with-original drafts. The agent returns 3-7 patterns
 * + a markdown block ready to paste into the user's style guide.
 * Result opens in the standard AiDraftDialog (Copy + optional
 * Save-as-draft so the user can keep iterating in the editor).
 */
export function LearnStyleButton() {
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<LearnStyleFromArchivesOutput | null>(
    null,
  );

  function run() {
    startTransition(async () => {
      try {
        const r = await learnStyleFromArchivesAction();
        if (r.ok) {
          setData(r.data);
          setOpen(true);
        } else if (r.reason === "not-configured") {
          toast.error(
            "Set ANTHROPIC_API_KEY in .env.local to enable style learning",
          );
        } else if (r.reason === "insufficient-samples") {
          toast.info(
            `Need 3+ archived drafts with original snapshots; you have ${r.sample_count ?? 0}.`,
          );
        } else {
          toast.error(r.message ?? "Couldn't run style learning");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't run style learning",
        );
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={run}
        disabled={pending}
        className="h-7 gap-1.5 text-xs"
        title="Analyze recent archived drafts and propose style-guide additions"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <GraduationCap className="size-3.5" />
        )}
        Learn style from archives
      </Button>
      <AiDraftDialog
        open={open}
        onOpenChange={setOpen}
        title="Style patterns from your recent archives"
        meta={
          data
            ? `${data.patterns.length} pattern${data.patterns.length === 1 ? "" : "s"} found`
            : ""
        }
        rationale={data?.framing ?? ""}
        body={data?.suggested_addition ?? ""}
      />
    </>
  );
}
