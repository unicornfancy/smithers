"use client";

import * as React from "react";
import { ListChecks, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import type { ActivityEvent } from "@smithers/mcp-client";

import { addProjectTaskFromActivityAction } from "@/app/projects/[slug]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Props {
  event: ActivityEvent;
  /** Project to add the task to. Required — workbench passes its own slug;
   * cross-project surfaces (e.g. /today) should fall back to the event's
   * project_match.project_slug when in_vault is true. */
  projectSlug: string;
  projectName?: string;
  /** Hide the button entirely when there's no valid project target. */
  hideWhenNoProject?: boolean;
}

export function AddTaskFromActivityButton({
  event,
  projectSlug,
  projectName,
  hideWhenNoProject = true,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(() => buildTaskTemplate(event));
  const [saving, setSaving] = React.useState(false);

  // Reset prefilled text when the event changes (so the same dialog
  // mount handles different rows).
  React.useEffect(() => {
    setText(buildTaskTemplate(event));
  }, [event]);

  if (!projectSlug && hideWhenNoProject) return null;

  async function handleSubmit() {
    if (!projectSlug) {
      toast.error("No project to add the task to");
      return;
    }
    setSaving(true);
    try {
      const result = await addProjectTaskFromActivityAction(
        projectSlug,
        text,
        event.url ?? null,
      );
      if (result.ok) {
        toast.success(`Task added to ${projectName ?? projectSlug}`);
        setOpen(false);
      } else {
        toast.error(result.reason);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Add failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5",
          "rounded px-1 py-0.5 text-[10px] opacity-0 transition-opacity",
          "focus-visible:opacity-100 group-hover:opacity-100",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
        title="Add as task to project Open Items"
        aria-label="Add as task to project Open Items"
      >
        <Plus className="size-3" />
        Task
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ListChecks className="size-4" />
              Add task to {projectName ?? projectSlug}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-muted-foreground text-xs">
              Appends to{" "}
              <code className="bg-muted rounded px-1">## Open Items</code> in
              the project file. The source URL is preserved as a trailing
              markdown link so you can jump back to the original event.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              disabled={saving}
              autoFocus
              className={cn(
                "border-input bg-background focus-visible:ring-ring",
                "w-full resize-none rounded-md border p-2 text-sm",
                "focus-visible:outline-none focus-visible:ring-1",
              )}
            />
            {event.url ? (
              <p className="text-muted-foreground text-[11px]">
                Source:{" "}
                <code className="bg-muted rounded px-1 truncate inline-block max-w-full align-bottom">
                  {event.url}
                </code>
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saving || !text.trim()}
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Add task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function buildTaskTemplate(event: ActivityEvent): string {
  const verb = verbForSource(event.source, event.kind);
  const actor = event.actor?.name?.split(/\s+/)[0] ?? null;
  const sourceLabel = sourceLabelFor(event.source);
  const titlePart = event.title?.trim() ? `: ${event.title.trim()}` : "";

  const parts: string[] = [verb];
  if (actor) parts.push(actor + (event.actor?.is_external ? " (partner)" : ""));
  parts.push(`on ${sourceLabel}${titlePart}`);
  return parts.join(" ");
}

function verbForSource(
  source: ActivityEvent["source"],
  kind: ActivityEvent["kind"],
): string {
  if (source === "zendesk") return "Respond to";
  if (source === "slack" && kind === "message") return "Reply to";
  if (source === "github") {
    if (kind === "pr-opened" || kind === "pr-merged") return "Review";
    return "Follow up on";
  }
  if (source === "linear") return "Follow up on";
  return "Follow up on";
}

function sourceLabelFor(source: ActivityEvent["source"]): string {
  const map: Record<ActivityEvent["source"], string> = {
    slack: "Slack",
    github: "GitHub",
    linear: "Linear",
    zendesk: "Zendesk",
    p2: "P2",
    wpcom: "WP.com",
    google_drive: "Drive",
  };
  return map[source] ?? source;
}
