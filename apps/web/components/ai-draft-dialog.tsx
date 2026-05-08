"use client";

import * as React from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  FileEdit,
  Loader2,
  RefreshCw,
  Save,
  Sliders,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { saveAsDraftAction } from "@/app/drafts/actions";
import { encodeDraftIdForUrl } from "@/lib/draft-id-url";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title of the dialog (e.g. "Drafted nudge for: …"). */
  title: string;
  /** Short metadata line under the title (e.g. "Email · soft tone"). */
  meta?: string;
  /** One-sentence rationale for why the agent picked this shape. */
  rationale: string;
  /** Optional subject line (rendered as its own input when present). */
  subject?: string;
  /** Body of the draft. Editable — user can tweak before copying. */
  body: string;
  /**
   * Optional read-only context block shown at the top — e.g. the latest
   * partner message on the Zendesk ticket being replied to. Persists into
   * the saved draft's frontmatter when Save as draft is clicked.
   */
  preview?: { label: string; body: string; meta?: string } | null;
  /**
   * When provided, surfaces a "Regenerate" button + collapsible
   * "Additional instructions" textarea inside the dialog. The callback
   * receives the user's one-shot intent string (empty string = same
   * context, no extra direction) and is expected to re-run the agent
   * + update the body/rationale/meta props.
   */
  onRegenerate?: (intent: string) => Promise<void> | void;
  /**
   * When provided, surfaces a "Change context" link that closes the
   * dialog so the caller can reopen the context picker with the
   * existing curated items.
   */
  onChangeContext?: () => void;
  /** True while the parent is mid-regenerate; disables Regenerate + grays the body. */
  regenerating?: boolean;
  /**
   * When provided, exposes a "Save as draft" button that writes the
   * current edited content into `Drafts/` as a new draft with the
   * AI's first pass snapshotted in frontmatter. Without these props
   * the button is hidden (Copy-only flow).
   */
  saveAsDraft?: {
    /** Title used for the new draft's filename + H1. */
    suggestedTitle: string;
    /** Optional project to attach the draft to. */
    projectSlug?: string;
    /** Which agent produced the original draft (telemetry + style-loop). */
    sourceAgent: string;
    /** Channel hint stored in frontmatter ("email" / "slack" / etc.). */
    channel?: string;
  };
}

/**
 * Reusable result dialog for any AI-drafting affordance. Shows the
 * generated draft as an editable textarea, the agent's rationale,
 * and a Copy button that puts subject + body on the clipboard so
 * the user can paste straight into Gmail / Slack / Zendesk.
 *
 * Both the draft and (optional) subject reset on each new render so
 * the dialog is single-use per generation — re-running the agent
 * yields a fresh draft.
 */
export function AiDraftDialog({
  open,
  onOpenChange,
  title,
  meta,
  rationale,
  subject,
  body,
  preview,
  onRegenerate,
  onChangeContext,
  regenerating,
  saveAsDraft,
}: Props) {
  const [editedSubject, setEditedSubject] = React.useState(subject ?? "");
  const [editedBody, setEditedBody] = React.useState(body);
  const [copied, setCopied] = React.useState(false);
  const [savingDraft, startSaveDraft] = React.useTransition();
  const [savedDraft, setSavedDraft] = React.useState<{
    draft_id: string;
    relative_path: string;
  } | null>(null);
  const [regeneratePanelOpen, setRegeneratePanelOpen] = React.useState(false);
  const [regenerateIntent, setRegenerateIntent] = React.useState("");

  // Re-seed when a new draft lands (parent passes new body/subject).
  React.useEffect(() => {
    if (open) {
      setEditedSubject(subject ?? "");
      setEditedBody(body);
      setCopied(false);
      setSavedDraft(null);
      setRegeneratePanelOpen(false);
      setRegenerateIntent("");
    }
  }, [open, subject, body]);

  function handleSaveAsDraft() {
    if (!saveAsDraft) return;
    startSaveDraft(async () => {
      try {
        const r = await saveAsDraftAction({
          project_slug: saveAsDraft.projectSlug,
          title: saveAsDraft.suggestedTitle,
          body: editedSubject
            ? `Subject: ${editedSubject}\n\n${editedBody}`
            : editedBody,
          original_body: subject
            ? `Subject: ${subject}\n\n${body}`
            : body,
          source_agent: saveAsDraft.sourceAgent,
          subject: editedSubject || undefined,
          channel: saveAsDraft.channel,
          context_preview: preview?.body,
          context_preview_label: preview?.label,
          context_preview_meta: preview?.meta,
        });
        setSavedDraft(r);
        toast.success(`Saved as draft · ${r.relative_path}`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't save draft",
        );
      }
    });
  }

  async function copyToClipboard() {
    const text = editedSubject
      ? `Subject: ${editedSubject}\n\n${editedBody}`
      : editedBody;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't copy to clipboard",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {meta ? (
            <DialogDescription>{meta}</DialogDescription>
          ) : null}
        </DialogHeader>

        {preview ? (
          <div className="space-y-1.5">
            <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {preview.label}
              {preview.meta ? (
                <span className="text-muted-foreground/70 ml-2 normal-case">
                  {preview.meta}
                </span>
              ) : null}
            </div>
            <div className="bg-muted/40 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md border px-3 py-2 text-xs leading-relaxed">
              {preview.body}
            </div>
          </div>
        ) : null}

        {subject !== undefined ? (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="ai-draft-subject"
              className="text-foreground text-xs font-medium"
            >
              Subject
            </label>
            <input
              id="ai-draft-subject"
              type="text"
              value={editedSubject}
              onChange={(e) => setEditedSubject(e.target.value)}
              className={cn(
                "border-input bg-background focus-visible:ring-ring",
                "h-8 rounded-md border px-2.5 text-sm",
                "focus-visible:outline-none focus-visible:ring-1",
              )}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <label
            htmlFor="ai-draft-body"
            className="text-foreground text-xs font-medium"
          >
            Draft
          </label>
          <textarea
            id="ai-draft-body"
            value={editedBody}
            onChange={(e) => setEditedBody(e.target.value)}
            rows={10}
            className={cn(
              "border-input bg-background focus-visible:ring-ring",
              "w-full resize-y rounded-md border px-3 py-2 text-sm leading-relaxed",
              "focus-visible:outline-none focus-visible:ring-1",
            )}
          />
        </div>

        {rationale ? (
          <p className="text-muted-foreground text-[11px] italic leading-snug">
            {rationale}
          </p>
        ) : null}

        {onRegenerate || onChangeContext ? (
          <div className="space-y-2 rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <Sparkles className="size-3" />
                Adjust this draft
              </div>
              <div className="flex items-center gap-1">
                {onChangeContext ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onChangeContext}
                    disabled={regenerating}
                    className="h-7 gap-1 px-2 text-xs"
                    title="Reopen the context picker to add or remove items"
                  >
                    <Sliders className="size-3" />
                    Change context
                  </Button>
                ) : null}
                {onRegenerate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setRegeneratePanelOpen((v) => !v)
                    }
                    disabled={regenerating}
                    className="h-7 gap-1 px-2 text-xs"
                  >
                    <RefreshCw className="size-3" />
                    Regenerate…
                  </Button>
                ) : null}
              </div>
            </div>
            {regeneratePanelOpen && onRegenerate ? (
              <div className="space-y-2">
                <textarea
                  value={regenerateIntent}
                  onChange={(e) => setRegenerateIntent(e.target.value)}
                  placeholder="Optional: shape this run (e.g. 'shorter', 'ask for screenshots', 'decline gracefully')"
                  rows={2}
                  className={cn(
                    "border-input bg-background focus-visible:ring-ring",
                    "w-full resize-y rounded-md border px-2.5 py-1.5 text-xs leading-snug",
                    "focus-visible:outline-none focus-visible:ring-1",
                  )}
                  disabled={regenerating}
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={async () => {
                      const intent = regenerateIntent.trim();
                      await onRegenerate(intent);
                    }}
                    disabled={regenerating}
                    className="h-7 gap-1.5 text-xs"
                  >
                    {regenerating ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    Regenerate
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {saveAsDraft && !savedDraft ? (
          <p className="text-muted-foreground text-[11px] leading-snug">
            <span className="font-medium">Tip:</span> saving as a draft snapshots
            the AI&apos;s first pass and tracks your edits — when you archive,
            those edits feed your my-voice rules.
          </p>
        ) : null}

        <DialogFooter>
          {saveAsDraft ? (
            savedDraft ? (
              <Button asChild variant="ghost" className="gap-1.5">
                <Link href={`/drafts/${encodeDraftIdForUrl(savedDraft.draft_id)}`}>
                  <FileEdit className="size-3.5" />
                  Open draft
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveAsDraft}
                disabled={savingDraft}
                className="gap-1.5"
              >
                {savingDraft ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save as draft
              </Button>
            )
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button type="button" onClick={copyToClipboard} className="gap-1.5">
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
