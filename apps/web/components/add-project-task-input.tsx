"use client";

import { Loader2, Plus } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { addProjectTaskAction } from "@/app/projects/[slug]/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  projectSlug: string;
}

/**
 * Inline textarea pinned to the bottom of the Open Items panel. Enter
 * submits (single- or multi-line), Shift+Enter inserts a newline for
 * subtasks. Multi-line input becomes a parent `- [ ]` task with one
 * indented `- [ ]` subtask per additional line — handled server-side
 * by `appendProjectTask`. No optimistic insert because server-side
 * ids depend on section + index; revalidatePath is fast enough that
 * a brief pending state reads as "saving" rather than lag.
 */
export function AddProjectTaskInput({ projectSlug }: Props) {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    startTransition(async () => {
      try {
        await addProjectTaskAction(projectSlug, trimmed);
        setText("");
        // Refocus so the user can keep typing the next item without
        // reaching for the mouse — mirrors the rhythm of bullet lists
        // in Obsidian/Notion.
        inputRef.current?.focus();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't add task",
        );
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-start gap-2 pt-2"
    >
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        disabled={pending}
        placeholder="Add a task… (Shift+Enter for a subtask)"
        aria-label="Add a task"
        className={cn(
          "border-input bg-background focus-visible:ring-ring",
          "min-h-8 flex-1 resize-y rounded-md border px-3 py-1.5 text-sm leading-5",
          "focus-visible:outline-none focus-visible:ring-1",
          "disabled:opacity-60",
        )}
      />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        disabled={!text.trim() || pending}
        className="h-8 shrink-0 gap-1 px-2 text-xs"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Plus className="size-3.5" />
        )}
        Add
      </Button>
    </form>
  );
}
