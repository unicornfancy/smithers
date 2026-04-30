"use client";

import { Check, Copy, Loader2, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  applyHiveMindEntryAction,
  previewHiveMindEntryAction,
} from "@/app/settings/hive-mind-actions";
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
  partnerSlug: string;
  displayName: string;
}

type DialogState =
  | { kind: "loading" }
  | { kind: "ready"; content: string; targetPath: string }
  | { kind: "error"; message: string }
  | { kind: "applied"; path: string };

/**
 * Per-row action: preview the partner-knowledge.md that would be
 * written, confirm, write. Uses a dialog so the user can see the
 * exact bytes before committing — this is a write into the team-
 * shared Hive Mind, so the explicit-confirm gate matters.
 */
export function HiveMindReconcileButton({ partnerSlug, displayName }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DialogState>({ kind: "loading" });
  const [applying, startApply] = useTransition();

  async function openPreview() {
    setOpen(true);
    setState({ kind: "loading" });
    const result = await previewHiveMindEntryAction(partnerSlug);
    if (!result.ok) {
      setState({ kind: "error", message: result.error });
      return;
    }
    setState({
      kind: "ready",
      content: result.content,
      targetPath: result.target_path,
    });
  }

  function apply() {
    startApply(async () => {
      const result = await applyHiveMindEntryAction(partnerSlug);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setState({ kind: "applied", path: result.path });
      toast.success(`Created ${displayName} in Hive Mind`);
    });
  }

  async function copyPath() {
    if (state.kind !== "ready" && state.kind !== "applied") return;
    const path =
      state.kind === "ready" ? state.targetPath : state.path;
    try {
      await navigator.clipboard.writeText(path);
      toast.success("Path copied");
    } catch {
      toast.error("Couldn't access clipboard");
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
        onClick={openPreview}
      >
        <Plus className="size-3" />
        Add to Hive Mind
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add {displayName} to Hive Mind</DialogTitle>
            <DialogDescription>
              {state.kind === "applied"
                ? "File written. Review the diff in your Hive Mind clone, then commit + push manually."
                : "Preview the partner-knowledge.md that will be created. The file write happens here; the git commit + push is up to you."}
            </DialogDescription>
          </DialogHeader>

          {state.kind === "loading" ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Generating preview…
            </div>
          ) : null}

          {state.kind === "error" ? (
            <p className="text-destructive py-2 text-sm">{state.message}</p>
          ) : null}

          {state.kind === "ready" || state.kind === "applied" ? (
            <div className="flex flex-col gap-3 py-2">
              <div>
                <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                  Target path
                </p>
                <code className="text-foreground break-all font-mono text-xs">
                  {state.kind === "ready" ? state.targetPath : state.path}
                </code>
              </div>
              <div>
                <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                  partner-knowledge.md
                </p>
                <pre className="bg-muted mt-1 max-h-80 overflow-auto rounded p-3 text-[11px] leading-relaxed">
                  {state.kind === "ready" ? state.content : ""}
                </pre>
              </div>
              {state.kind === "applied" ? (
                <p className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 text-sm">
                  <Check className="size-4" />
                  Written. Review the diff in your Hive Mind clone:
                  <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
                    cd ~/Team51-Hive-Mind && git status
                  </code>
                </p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            {state.kind === "ready" ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyPath}
                  className="gap-1.5"
                >
                  <Copy className="size-3.5" />
                  Copy path
                </Button>
                <Button size="sm" onClick={apply} disabled={applying}>
                  {applying ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Writing…
                    </>
                  ) : (
                    "Create file"
                  )}
                </Button>
              </>
            ) : null}
            {state.kind === "applied" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={copyPath}
                className="gap-1.5"
              >
                <Copy className="size-3.5" />
                Copy path
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
