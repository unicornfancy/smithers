"use client";

import { ArrowRightLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { convertTaskToFollowUpAction } from "@/app/projects/[slug]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 disabled:opacity-60";

interface Props {
  projectSlug: string;
  taskId: string;
  taskText: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ConvertTaskToFollowUpButton({
  projectSlug,
  taskId,
  taskText,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sentTo, setSentTo] = useState("");
  const [sent, setSent] = useState(todayIso());
  const [followUpBy, setFollowUpBy] = useState("");

  function handleOpenChange(v: boolean) {
    setOpen(v);
    // Reset form when closing without submitting.
    if (!v) {
      setSentTo("");
      setSent(todayIso());
      setFollowUpBy("");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const r = await convertTaskToFollowUpAction(projectSlug, taskId, {
          sent_to: sentTo || undefined,
          sent: sent || undefined,
          follow_up_by: followUpBy || undefined,
        });
        if (r.ok) {
          toast.success(`Converted to follow-up: ${truncate(taskText, 50)}`);
          setOpen(false);
          router.refresh();
        } else {
          toast.error(r.message ?? "Conversion failed");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Conversion failed",
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          title="Convert to follow-up"
          aria-label={`Convert to follow-up: ${taskText}`}
          className={cn(
            "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded",
            "text-muted-foreground hover:text-violet-600 hover:bg-violet-500/10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <ArrowRightLeft className="size-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert to follow-up</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs font-medium">
              Task
            </span>
            <p className="bg-muted rounded px-3 py-2 text-sm">{taskText}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ctf-sent-to" className="text-sm font-medium">
              Sent to
            </label>
            <input
              id="ctf-sent-to"
              value={sentTo}
              onChange={(e) => setSentTo(e.target.value)}
              placeholder="e.g. Martin (optional)"
              disabled={pending}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="ctf-sent" className="text-sm font-medium">
                Sent date
              </label>
              <input
                id="ctf-sent"
                type="date"
                value={sent}
                onChange={(e) => setSent(e.target.value)}
                disabled={pending}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ctf-follow-up-by" className="text-sm font-medium">
                Follow-up by{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <input
                id="ctf-follow-up-by"
                type="date"
                value={followUpBy}
                onChange={(e) => setFollowUpBy(e.target.value)}
                disabled={pending}
                className={inputClass}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Convert
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
