"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

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
}: Props) {
  const [editedSubject, setEditedSubject] = React.useState(subject ?? "");
  const [editedBody, setEditedBody] = React.useState(body);
  const [copied, setCopied] = React.useState(false);

  // Re-seed when a new draft lands (parent passes new body/subject).
  React.useEffect(() => {
    if (open) {
      setEditedSubject(subject ?? "");
      setEditedBody(body);
      setCopied(false);
    }
  }, [open, subject, body]);

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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {meta ? (
            <DialogDescription>{meta}</DialogDescription>
          ) : null}
        </DialogHeader>

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

        <DialogFooter>
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
