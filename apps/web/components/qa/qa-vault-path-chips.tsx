"use client";

import * as React from "react";
import { Check, Copy, FileText, FolderOpen } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  jsonAbsPath: string | null;
  mdAbsPath: string | null;
}

/**
 * Per-run "grab the markdown to paste into Linear" affordances. Shows
 * the absolute on-disk path of the saved report (markdown and JSON)
 * with copy + open-folder buttons.
 *
 * `file://` links work in Obsidian, Finder, and most editors but not
 * in browsers — we render them with `download` and a friendly tooltip
 * so the user knows what to expect.
 */
export function QaVaultPathChips({ jsonAbsPath, mdAbsPath }: Props) {
  if (!jsonAbsPath && !mdAbsPath) return null;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-2 py-3">
        <span className="text-muted-foreground mr-1 text-xs font-medium uppercase tracking-wide">
          Saved at
        </span>
        {mdAbsPath ? (
          <PathChip
            label="Markdown"
            icon={<FileText className="size-3.5" />}
            path={mdAbsPath}
          />
        ) : null}
        {jsonAbsPath ? (
          <PathChip
            label="JSON"
            icon={<FileText className="size-3.5" />}
            path={jsonAbsPath}
          />
        ) : null}
        {(mdAbsPath ?? jsonAbsPath) ? (
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="ml-auto h-7 gap-1.5 text-xs"
          >
            <a
              href={`file://${encodeURI((mdAbsPath ?? jsonAbsPath)!.replace(/\/[^/]+$/, ""))}`}
              target="_blank"
              rel="noreferrer"
            >
              <FolderOpen className="size-3.5" />
              Open folder
            </a>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PathChip({
  label,
  icon,
  path,
}: {
  label: string;
  icon: React.ReactNode;
  path: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      toast.success(`${label} path copied`);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed — your browser may block clipboard access");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="bg-muted/40 hover:bg-muted text-foreground inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors"
      title={path}
    >
      {icon}
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground truncate font-mono">
        {shortenPath(path)}
      </span>
      {copied ? (
        <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="text-muted-foreground size-3" />
      )}
    </button>
  );
}

/** Show the last 3 path segments — full path is in the title tooltip. */
function shortenPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-3).join("/")}`;
}
