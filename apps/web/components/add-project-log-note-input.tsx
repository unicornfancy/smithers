"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { addProjectLogNoteAction } from "@/app/projects/[slug]/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  projectSlug: string;
  hiveMindConfigured: boolean;
}

export function AddProjectLogNoteInput({
  projectSlug,
  hiveMindConfigured,
}: Props) {
  const [open, setOpen] = useState(false);
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setOpen(false);
    setHeading("");
    setBody("");
  }

  function submit() {
    const h = heading.trim();
    const b = body.trim();
    if (!h || !b || pending) return;
    startTransition(async () => {
      try {
        const result = await addProjectLogNoteAction(projectSlug, h, b);
        if (!result.ok) {
          toast.error(result.reason ?? "Couldn't add note");
          return;
        }
        reset();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't add note");
      }
    });
  }

  if (!hiveMindConfigured) {
    return (
      <div className="pt-2">
        <span title="Connect project to Hive-Mind to enable notes.">
          <Button
            size="sm"
            variant="ghost"
            disabled
            className="h-7 gap-1.5 px-2 text-xs opacity-50"
          >
            <Plus className="size-3.5" />
            Add note
          </Button>
        </span>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="pt-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen(true)}
          className="h-7 gap-1.5 px-2 text-xs"
        >
          <Plus className="size-3.5" />
          Add note
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-2 pt-2"
    >
      <input
        type="text"
        value={heading}
        onChange={(e) => setHeading(e.target.value)}
        disabled={pending}
        placeholder="Note heading…"
        aria-label="Note heading"
        className={cn(
          "border-input bg-background focus-visible:ring-ring",
          "h-8 w-full rounded-md border px-3 text-sm",
          "focus-visible:outline-none focus-visible:ring-1",
          "disabled:opacity-60",
        )}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={pending}
        placeholder="Note body…"
        aria-label="Note body"
        rows={4}
        className={cn(
          "border-input bg-background focus-visible:ring-ring",
          "w-full rounded-md border px-3 py-2 text-sm",
          "focus-visible:outline-none focus-visible:ring-1",
          "disabled:opacity-60 resize-none",
        )}
      />
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={!heading.trim() || !body.trim() || pending}
          className="h-7 gap-1.5 px-2 text-xs"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
          Save note
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={reset}
          className="h-7 gap-1.5 px-2 text-xs"
        >
          <X className="size-3.5" />
          Cancel
        </Button>
      </div>
    </form>
  );
}
