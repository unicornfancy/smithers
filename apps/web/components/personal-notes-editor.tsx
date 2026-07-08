"use client";

import * as React from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, PenLine } from "lucide-react";
import { toast } from "sonner";

import { savePersonalNotesAction } from "@/app/projects/[slug]/actions";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  projectSlug: string;
  /** Initial body — empty string when no file exists yet. */
  initialBody: string;
  /** Relative path where the file lives (or would live). Shown as a hint. */
  relativePath: string | null;
  /** True when this is the first-write case — used for the empty-state copy. */
  isNew: boolean;
}

const SAVE_DEBOUNCE_MS = 1500;
const inputClass =
  "border-input bg-background focus-visible:ring-ring w-full rounded-md border p-3 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1";

/**
 * Auto-saving editor for a project's personal notes. Same debounce
 * shape as DraftEditor: any keystroke schedules a save 1.5s out; a
 * fresh keystroke cancels and restarts the timer. Save-on-blur
 * catches the case where the user tabs away mid-thought.
 *
 * Toggle between edit and preview so the same textarea supports
 * both editing and rendered-markdown viewing without cluttering the
 * workbench with a two-pane layout.
 */
export function PersonalNotesEditor({
  projectSlug,
  initialBody,
  relativePath,
  isNew,
}: Props) {
  const [body, setBody] = React.useState(initialBody);
  const [savedBody, setSavedBody] = React.useState(initialBody);
  const [saving, setSaving] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);
  const [pathLabel, setPathLabel] = React.useState(relativePath);

  const dirty = body !== savedBody;

  const save = React.useCallback(
    async (next: string) => {
      setSaving(true);
      try {
        const r = await savePersonalNotesAction(projectSlug, next);
        if (r.ok) {
          setSavedBody(next);
          if (r.changed) setLastSavedAt(new Date());
          setPathLabel(r.relative_path);
        } else {
          toast.error(r.message);
        }
      } finally {
        setSaving(false);
      }
    },
    [projectSlug],
  );

  React.useEffect(() => {
    if (!dirty) return;
    const handle = setTimeout(() => void save(body), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [body, dirty, save]);

  function handleBlur() {
    if (dirty) void save(body);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-[11px]">
          {pathLabel ? (
            <>
              Saved at{" "}
              <code className="bg-muted rounded px-1 font-mono text-[10px]">
                {pathLabel}
              </code>
              {" · "}private, never synced to Hive Mind
            </>
          ) : (
            "Private, never synced to Hive Mind"
          )}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-[11px]">
            {saving ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                Saving…
              </span>
            ) : dirty ? (
              "Unsaved"
            ) : lastSavedAt ? (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
                Saved {timeAgo(lastSavedAt)}
              </span>
            ) : null}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setPreview((p) => !p)}
            className="h-7 gap-1.5"
          >
            {preview ? (
              <>
                <PenLine className="size-3.5" />
                Edit
              </>
            ) : (
              <>
                <Eye className="size-3.5" />
                Preview
              </>
            )}
          </Button>
        </div>
      </div>

      {preview ? (
        <div className="prose prose-sm dark:prose-invert bg-muted/30 max-w-none rounded-md border p-3 text-sm">
          {body.trim() ? (
            <Markdown source={body} />
          ) : (
            <p className="text-muted-foreground italic">Nothing to preview.</p>
          )}
        </div>
      ) : (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={handleBlur}
          className={cn(inputClass, "min-h-[240px] resize-y leading-relaxed")}
          placeholder={
            isNew
              ? "Personal notes for this project. Anything you want to remember: quirks, one-off preferences, running to-do lists that don't belong on the shared surfaces. Markdown works. Auto-saves as you type."
              : ""
          }
          spellCheck
        />
      )}
    </div>
  );
}

function timeAgo(when: Date): string {
  const secs = Math.max(1, Math.floor((Date.now() - when.getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return when.toLocaleDateString();
}
