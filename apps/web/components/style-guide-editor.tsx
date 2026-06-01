"use client";

import * as React from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { readStyleFileAction, saveStyleFileAction } from "@/app/style-guide/actions";
import { MY_VOICE_FILES } from "@/lib/my-voice-files";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";

interface Props {
  initialFilename?: string;
  initialContent: string | null;
  configured: boolean;
  myVoicePath: string | null;
}

const SAVE_DEBOUNCE_MS = 1500;

export function StyleGuideEditor({
  initialFilename,
  initialContent,
  configured,
  myVoicePath,
}: Props) {
  const [activeFilename, setActiveFilename] = React.useState(
    initialFilename ?? MY_VOICE_FILES[0]!.filename,
  );
  const [content, setContent] = React.useState(initialContent ?? "");
  const [savedContent, setSavedContent] = React.useState(initialContent ?? "");
  const [saving, setSaving] = React.useState(false);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const [learning, setLearning] = React.useState(false);
  const dirty = content !== savedContent;

  // Auto-save: 1.5s debounce after keystroke.
  React.useEffect(() => {
    if (!configured) return;
    if (content === savedContent) return;
    const handle = setTimeout(() => {
      void performSave(activeFilename, content);
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  async function performSave(filename: string, body: string) {
    setSaving(true);
    try {
      const result = await saveStyleFileAction(filename, body);
      if (result.ok) {
        setSavedContent(body);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1500);
      } else {
        toast.error(result.message ?? "Save failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleTabSwitch(filename: string) {
    if (filename === activeFilename) return;
    // Save the current file immediately before switching.
    if (dirty) {
      await performSave(activeFilename, content);
    }
    setActiveFilename(filename);
    const loaded = await readStyleFileAction(filename);
    const body = loaded ?? "";
    setContent(body);
    setSavedContent(body);
  }

  async function handleLearnFromArchives() {
    setLearning(true);
    try {
      const res = await fetch("/api/learn-from-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        ok: boolean;
        applied?: { filename: string; heading: string }[];
        error?: string;
      };
      if (data.ok) {
        const n = data.applied?.length ?? 0;
        if (n > 0) {
          toast.success(`${n} learning${n === 1 ? "" : "s"} added to style guide`);
          // Reload the currently-visible file if it was updated.
          const wasUpdated = data.applied?.some(
            (a) => a.filename === activeFilename,
          );
          if (wasUpdated) {
            const refreshed = await readStyleFileAction(activeFilename);
            const body = refreshed ?? "";
            setContent(body);
            setSavedContent(body);
          }
        } else {
          toast.success("No new learnings — archive more drafts first");
        }
      } else {
        toast.error(data.error ?? "Learn from archives failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLearning(false);
    }
  }

  if (!configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Style Guide</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            my_voice path not configured — add{" "}
            <code className="bg-muted rounded px-1 py-0.5 text-xs font-mono">
              paths.my_voice
            </code>{" "}
            to config.local.yaml to enable editing.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header row: tabs + actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* File picker tabs */}
        <div className="flex flex-wrap gap-1">
          {MY_VOICE_FILES.map((f) => (
            <button
              key={f.filename}
              type="button"
              onClick={() => void handleTabSwitch(f.filename)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                activeFilename === f.filename
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Actions + save status */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground inline-block w-[120px] text-right text-[11px] tabular-nums">
            {saving
              ? "Saving..."
              : savedFlash
                ? "Saved"
                : dirty
                  ? "Unsaved changes"
                  : "All changes saved"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleLearnFromArchives()}
            disabled={learning}
            className="h-7 gap-1.5 text-xs"
          >
            {learning ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Learn from archives
          </Button>
        </div>
      </div>

      {/* Two-panel editor — columns are fixed height + scroll internally so
          typing into a long file doesn't grow the row and shift the textarea
          around (live preview previously dragged both columns taller via the
          grid's default align-items: stretch). */}
      <div className="grid items-start gap-3 md:grid-cols-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck
          className={cn(
            "border-input bg-background focus-visible:ring-ring",
            "h-[70vh] w-full rounded-md border p-3 font-mono text-sm leading-relaxed",
            "focus-visible:outline-none focus-visible:ring-1",
            "resize-y",
          )}
        />
        <div className="border-input bg-background h-[70vh] overflow-y-auto rounded-md border p-4">
          {content.trim() ? (
            <Markdown source={content} />
          ) : (
            <p className="text-muted-foreground text-sm italic">
              Preview will appear here as you type.
            </p>
          )}
        </div>
      </div>

      <p className="text-muted-foreground text-[11px]">
        Auto-saves 1.5s after you stop typing. Stored at{" "}
        <code className="bg-muted rounded px-1 py-0.5 text-[10px] font-mono">
          {myVoicePath}
        </code>
      </p>
    </div>
  );
}
