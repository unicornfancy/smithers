"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { linkExternalBriefAction } from "@/app/projects/[slug]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Props {
  projectSlug: string;
  /** True when the project already has a brief — the dialog warns about overwrite. */
  hasExistingBrief: boolean;
  label?: string;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "ghost";
}

/**
 * Pairs with GenerateBriefButton in the Project Brief section header.
 * For partners whose canonical brief still lives in a pre-Smithers
 * Google Doc, this skips AI generation and points the workbench at
 * that Doc instead — the existing brief renderer already surfaces
 * `google_doc_url` frontmatter as an "Open in Google Docs" link.
 */
export function LinkExistingBriefButton({
  projectSlug,
  hasExistingBrief,
  label = "Link existing brief",
  size = "sm",
  variant = "ghost",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      toast.error("Google Doc URL is required");
      return;
    }
    setPending(true);
    try {
      const res = await linkExternalBriefAction({
        slug: projectSlug,
        google_doc_url: url.trim(),
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success("Brief linked");
      setOpen(false);
      setUrl("");
      setNote("");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        size={size}
        variant={variant}
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Link2 className="size-3.5" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link an existing brief</DialogTitle>
            <DialogDescription>
              Point this project at a brief that lives in Google Docs. The
              workbench will render an &quot;Open in Google Docs&quot; link
              instead of an AI-generated brief.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Google Doc URL
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://docs.google.com/document/d/…/edit"
                disabled={pending}
                required
                className={cn(
                  "border-input bg-background focus-visible:ring-ring",
                  "w-full rounded-md border px-3 py-2 text-sm",
                  "focus-visible:outline-none focus-visible:ring-1",
                )}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Note <span className="font-normal normal-case opacity-70">(optional)</span>
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. 'Brief drafted by Bob during cover, June 2026.'"
                disabled={pending}
                rows={2}
                className={cn(
                  "border-input bg-background focus-visible:ring-ring",
                  "w-full rounded-md border px-3 py-2 text-sm",
                  "focus-visible:outline-none focus-visible:ring-1",
                )}
              />
            </div>
            {hasExistingBrief ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                A brief already exists for this project. Linking will overwrite{" "}
                <code>brief.md</code> with the link to the Google Doc.
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !url.trim()} className="gap-1.5">
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="size-3.5" />
                )}
                Link brief
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
