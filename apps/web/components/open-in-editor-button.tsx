"use client";

import * as React from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { openInEditorAction } from "@/app/actions/open-in-editor";
import { cn } from "@/lib/utils";

interface Props {
  /** Absolute filesystem path. Passed verbatim to the OS opener. */
  path: string;
  /** Display label. Falls back to "Open in editor". */
  children?: React.ReactNode;
  /** Inline-link visual style by default; "button" makes it look like a chip. */
  variant?: "inline" | "button";
  className?: string;
}

/**
 * Replaces `<a href="file://...">` which browsers silently block from
 * http:// pages. Shells out via the server action so the user's
 * default app picks up the file (Obsidian for a vault markdown, Finder
 * for a folder, etc).
 */
export function OpenInEditorButton({
  path,
  children = "Open in editor",
  variant = "inline",
  className,
}: Props) {
  const [pending, setPending] = React.useState(false);

  async function handleClick() {
    setPending(true);
    try {
      const res = await openInEditorAction(path);
      if (!res.ok) {
        toast.error(res.reason);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title={path}
      className={cn(
        variant === "inline"
          ? "text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          : "border-input bg-background hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        className,
      )}
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <ExternalLink className="size-3" />
      )}
      {children}
    </button>
  );
}
