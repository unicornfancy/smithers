"use client";

import * as React from "react";
import { Copy, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import {
  openBriefFileAction,
  readBriefFileAction,
} from "@/app/projects/[slug]/actions";

interface Props {
  projectSlug: string;
}

/**
 * "Edit brief" + "Copy markdown" affordances on the workbench brief
 * header. Edit shells `open <path>` server-side so the file opens in
 * the OS-registered Markdown editor (Obsidian, VS Code, etc.) — the
 * old `file://` anchor didn't work because browsers block file:// from
 * http:// pages. Copy grabs the current on-disk markdown so what
 * lands on the clipboard matches what the file currently contains
 * (not a stale server-render).
 */
export function BriefFileActions({ projectSlug }: Props) {
  const [opening, setOpening] = React.useState(false);
  const [copying, setCopying] = React.useState(false);

  async function handleOpen() {
    setOpening(true);
    try {
      const result = await openBriefFileAction(projectSlug);
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success("Opened in your default Markdown editor.");
    } finally {
      setOpening(false);
    }
  }

  async function handleCopy() {
    setCopying(true);
    try {
      const result = await readBriefFileAction(projectSlug);
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      await navigator.clipboard.writeText(result.markdown);
      toast.success(
        `Copied ${result.markdown.length.toLocaleString()} chars to clipboard.`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't copy to clipboard",
      );
    } finally {
      setCopying(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={opening}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-normal disabled:opacity-60"
      >
        {opening ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Pencil className="size-3" />
        )}
        Edit brief
      </button>
      <button
        type="button"
        onClick={handleCopy}
        disabled={copying}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-normal disabled:opacity-60"
      >
        {copying ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Copy className="size-3" />
        )}
        Copy markdown
      </button>
    </>
  );
}
