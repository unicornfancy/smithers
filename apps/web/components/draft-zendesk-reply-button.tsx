"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import type { DraftZendeskReplyOutput } from "@smithers/agents";
import type { ContextItem } from "@smithers/mcp-client";

import {
  draftZendeskReplyAction,
  fetchZendeskLatestPartnerActivityAction,
} from "@/app/projects/[slug]/actions";
import { AiDraftDialog } from "@/components/ai-draft-dialog";
import { Button } from "@/components/ui/button";
import { DraftContextPickerDialog } from "@/components/draft-context-picker-dialog";

interface Props {
  projectSlug: string;
  ticketId: string;
  /** Subject (when known) used as dialog title context. */
  ticketSubject?: string | null;
}

/**
 * Inline "Draft reply" button on each Zendesk thread card. Phase H flow:
 *   click → ContextPicker dialog (review pinned context + attach extras)
 *   → user clicks Generate → draft-zendesk-reply agent runs with curated
 *   extra_context → AiDraftDialog opens with the generated reply.
 */
export function DraftZendeskReplyButton({
  projectSlug,
  ticketId,
  ticketSubject,
}: Props) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [data, setData] = React.useState<DraftZendeskReplyOutput | null>(null);
  const [preview, setPreview] = React.useState<
    { label: string; body: string; meta?: string } | null
  >(null);
  // Remember the most recent curated context list so Regenerate can re-run
  // with the same set without reopening the picker.
  const [lastContext, setLastContext] = React.useState<ContextItem[]>([]);

  function openPicker() {
    setPreview(null);
    setPickerOpen(true);
    // Fetch the latest partner message in the background so the picker
    // can render it once the data lands. Failures are silent — the
    // picker just doesn't render the preview block.
    void fetchZendeskLatestPartnerActivityAction(projectSlug, ticketId).then(
      (res) => {
        if (res.ok) {
          setPreview({
            label: "Latest partner reply",
            body: res.excerpt,
            meta: res.timestamp ? formatTs(res.timestamp) : undefined,
          });
        }
      },
    );
  }

  function runWithContext(items: ContextItem[]) {
    if (pending) return;
    setLastContext(items);
    startTransition(async () => {
      try {
        const r = await draftZendeskReplyAction(
          projectSlug,
          ticketId,
          undefined,
          items,
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
          toast.error(r.message ?? "Couldn't draft reply");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't draft reply",
        );
      }
    });
  }

  /**
   * Regenerate using the same context the user already curated, plus an
   * optional one-shot intent string ("shorter", "ask for screenshots",
   * etc.). Updates the dialog body in place rather than reopening it.
   */
  async function regenerate(intent: string) {
    if (pending) return;
    await new Promise<void>((resolve) =>
      startTransition(async () => {
        try {
          const r = await draftZendeskReplyAction(
            projectSlug,
            ticketId,
            intent || undefined,
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

  /** Close the dialog and reopen the picker so the user can swap context. */
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
        onClick={openPicker}
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
      <DraftContextPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={`Draft reply for #${ticketId}${ticketSubject ? ` — ${truncate(ticketSubject, 50)}` : ""}`}
        projectSlug={projectSlug}
        preview={preview}
        excludeZendeskTicketId={ticketId}
        onGenerate={runWithContext}
        busy={pending}
      />
      <AiDraftDialog
        open={draftOpen}
        onOpenChange={setDraftOpen}
        title={`Draft for #${ticketId}${ticketSubject ? ` — ${truncate(ticketSubject, 50)}` : ""}`}
        meta={data ? `${data.tone} tone` : ""}
        rationale={data?.rationale ?? ""}
        body={data?.draft ?? ""}
        preview={preview}
        onRegenerate={regenerate}
        onChangeContext={changeContext}
        regenerating={pending}
        saveAsDraft={
          data
            ? {
                suggestedTitle: `Zendesk #${ticketId}${ticketSubject ? ` — ${truncate(ticketSubject, 60)}` : ""}`,
                projectSlug,
                sourceAgent: "draft-zendesk-reply",
                channel: "zendesk",
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

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
