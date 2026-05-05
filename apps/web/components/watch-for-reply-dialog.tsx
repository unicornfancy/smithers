"use client";

import * as React from "react";
import { Eye, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { createLinkedFollowUpAction } from "@/app/projects/[slug]/actions";
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

interface Props {
  projectSlug: string;
  projectName: string;
  sourceType: "zendesk" | "github";
  sourceRef: string;
  defaultTask: string;
  trigger?: React.ReactNode;
}

const DATE_PRESETS: { days: number; label: string }[] = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 21, label: "21 days" },
  { days: 30, label: "30 days" },
];

function addDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 disabled:opacity-60";

export function WatchForReplyDialog({
  projectSlug,
  projectName,
  sourceType,
  sourceRef,
  defaultTask,
  trigger,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = useTransition();
  const [task, setTask] = React.useState(defaultTask);
  const [preset, setPreset] = React.useState<number | "custom">(14);
  const [customDate, setCustomDate] = React.useState(() => addDays(14));

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (!v) {
      setTask(defaultTask);
      setPreset(14);
      setCustomDate(addDays(14));
    }
  }

  const followUpBy = preset === "custom" ? customDate : addDays(preset);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = task.trim();
    if (!trimmed) {
      toast.error("Task text is required");
      return;
    }
    startTransition(async () => {
      try {
        const r = await createLinkedFollowUpAction(projectSlug, {
          project: projectName,
          task: trimmed,
          follow_up_by: followUpBy,
          source_type: sourceType,
          source_ref: sourceRef,
        });
        if (r.ok) {
          toast.success("Watching for reply");
          setOpen(false);
          router.refresh();
        } else {
          toast.error(r.message ?? "Couldn't create follow-up");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't create follow-up");
      }
    });
  }

  const defaultTrigger = (
    <button
      type="button"
      title="Watch for reply"
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
        "text-[11px] text-muted-foreground hover:text-foreground",
        "hover:bg-muted/60 transition-colors",
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Eye className="size-3" />
      Watch
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Watch for reply</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="wfr-task" className="text-sm font-medium">
              Task
            </label>
            <textarea
              id="wfr-task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={3}
              disabled={pending}
              className={cn(inputClass, "h-auto resize-none py-2")}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Follow up by</span>
            <div className="flex flex-wrap gap-2">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  disabled={pending}
                  onClick={() => setPreset(p.days)}
                  className={cn(
                    "rounded-md border px-3 py-1 text-sm transition-colors",
                    preset === p.days
                      ? "border-foreground bg-foreground text-background"
                      : "border-input text-muted-foreground hover:border-foreground/50 hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                disabled={pending}
                onClick={() => setPreset("custom")}
                className={cn(
                  "rounded-md border px-3 py-1 text-sm transition-colors",
                  preset === "custom"
                    ? "border-foreground bg-foreground text-background"
                    : "border-input text-muted-foreground hover:border-foreground/50 hover:text-foreground",
                )}
              >
                Custom
              </button>
            </div>
            {preset === "custom" ? (
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                disabled={pending}
                className={cn(inputClass, "w-44")}
              />
            ) : (
              <p className="text-muted-foreground text-xs">
                Due {followUpBy}
              </p>
            )}
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
              {pending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Watch for reply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
