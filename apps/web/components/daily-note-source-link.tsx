"use client";

import { Check, Copy, FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface Props {
  /** Absolute filesystem path to today's daily note. */
  path: string;
  /** True when the file already exists; controls labeling. */
  exists: boolean;
}

/**
 * Surface the absolute path of today's daily note so the user can open
 * it in their editor of choice (Obsidian, VS Code, Finder).
 *
 * The web app can't open external apps from the browser reliably, so
 * we just copy the path to the clipboard and let the user paste it
 * wherever they want.
 */
export function DailyNoteSourceLink({ path, exists }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      toast.success("Path copied — paste in Obsidian / Finder / your editor");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't access clipboard");
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground gap-1.5 text-xs"
      onClick={copy}
      title={path}
    >
      {copied ? (
        <Check className="size-3" />
      ) : (
        <FileText className="size-3" />
      )}
      <span className="hidden sm:inline">
        {exists ? "View source" : "Daily note path"}
      </span>
      {copied ? (
        <Copy className="size-3 opacity-60" aria-hidden />
      ) : null}
    </Button>
  );
}
