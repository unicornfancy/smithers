"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Eye, EyeOff, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import {
  archiveDraftAction,
  updateDraftBodyAction,
} from "@/app/drafts/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";

interface Props {
  draftId: string;
  initialBody: string;
  /** Archived drafts are read-only by default — explicit edits feel risky once a thing has shipped. */
  archived?: boolean;
}

const SAVE_DEBOUNCE_MS = 1500;

/**
 * In-app draft editor: textarea with auto-save (1.5s after last
 * keystroke) and an explicit Save button. Toggle Preview to render
 * the live markdown side-by-side. Archived drafts open read-only;
 * the user can still toggle Preview to read the rendered version.
 *
 * Atomic writes happen via the updateDraftBody vault helper —
 * frontmatter is preserved verbatim.
 */
export function DraftEditor({ draftId, initialBody, archived }: Props) {
  const router = useRouter();
  const [body, setBody] = React.useState(initialBody);
  const [savedBody, setSavedBody] = React.useState(initialBody);
  const [preview, setPreview] = React.useState(false);
  const [saving, startSaving] = React.useTransition();
  const [archiving, startArchiving] = React.useTransition();
  const [savedFlash, setSavedFlash] = React.useState(false);
  const dirty = body !== savedBody;

  function save(nextBody?: string) {
    const target = nextBody ?? body;
    if (target === savedBody) return;
    startSaving(async () => {
      try {
        await updateDraftBodyAction(draftId, target);
        setSavedBody(target);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1500);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't save draft",
        );
      }
    });
  }

  // Debounced auto-save: any keystroke schedules a save 1.5s out;
  // a fresh keystroke cancels and restarts the timer. Saves on
  // unmount too so closing the tab mid-edit doesn't drop work.
  React.useEffect(() => {
    if (archived) return;
    if (body === savedBody) return;
    const handle = setTimeout(() => save(body), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, archived]);

  function handleArchive() {
    if (archived) return;
    // Save any unsaved changes first so archive captures the latest body.
    function archive() {
      startArchiving(async () => {
        try {
          await archiveDraftAction(draftId);
          toast.success("Draft archived");
          // Refresh so the page picks up the new state — the editor
          // will re-mount as read-only.
          router.refresh();
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Couldn't archive draft",
          );
        }
      });
    }
    if (dirty) {
      startSaving(async () => {
        try {
          await updateDraftBodyAction(draftId, body);
          setSavedBody(body);
          archive();
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Couldn't save before archive",
          );
        }
      });
    } else {
      archive();
    }
  }

  // Cmd/Ctrl-S → explicit save.
  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-[11px]">
          {archived
            ? "Read-only · archived"
            : saving
              ? "Saving…"
              : savedFlash
                ? "Saved"
                : dirty
                  ? "Unsaved changes"
                  : "All changes saved"}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPreview((p) => !p)}
            className="h-7 gap-1.5 text-xs"
          >
            {preview ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
            {preview ? "Hide preview" : "Show preview"}
          </Button>
          {!archived ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleArchive}
                disabled={archiving || saving}
                title="Archive this draft (moves to Drafts/Archived Drafts/)"
                className="h-7 gap-1.5 text-xs"
              >
                {archiving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Archive className="size-3.5" />
                )}
                Archive
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => save()}
                disabled={!dirty || saving}
                className="h-7 gap-1.5 text-xs"
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : savedFlash ? (
                  <Check className="size-3.5" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {savedFlash ? "Saved" : "Save"}
              </Button>
            </>
          ) : null}
        </span>
      </div>

      <div
        className={cn(
          "grid gap-3",
          preview ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1",
        )}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          readOnly={archived}
          spellCheck
          className={cn(
            "border-input bg-background focus-visible:ring-ring",
            "min-h-[60vh] w-full rounded-md border p-3 font-mono text-sm leading-relaxed",
            "focus-visible:outline-none focus-visible:ring-1",
            "resize-y",
            archived && "opacity-80",
          )}
        />
        {preview ? (
          <div className="border-input min-h-[60vh] rounded-md border bg-background p-4 overflow-y-auto">
            <Markdown source={body} />
          </div>
        ) : null}
      </div>

      {!archived ? (
        <p className="text-muted-foreground text-[11px]">
          Auto-saves 1.5s after you stop typing. Cmd/Ctrl-S to save now.
        </p>
      ) : null}
    </div>
  );
}
