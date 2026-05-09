"use client";

import { Loader2, MinusCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { detachRecordingFromProjectAction } from "@/app/projects/[slug]/actions";
import { Button } from "@/components/ui/button";

interface Props {
  projectSlug: string;
  recordingId: string;
  /** Short label for the toast — usually the recording title. */
  recordingLabel?: string;
}

/**
 * "Not this project" button on a workbench Recent Calls row. Appends
 * the recording_id to the project's fathom_excluded_recording_ids so
 * the shared recordingMatchesProject helper hides it from this project
 * on future renders. Doesn't delete anything — the call still appears
 * on /calls and on any other matching project's workbench.
 */
export function DetachRecordingButton({
  projectSlug,
  recordingId,
  recordingLabel,
}: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    startTransition(async () => {
      const result = await detachRecordingFromProjectAction(
        projectSlug,
        recordingId,
      );
      if (result.ok) {
        toast.success(
          recordingLabel
            ? `Detached "${recordingLabel}"`
            : "Detached from this project",
        );
        router.refresh();
      } else {
        toast.error(result.reason);
      }
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-destructive h-6 w-6 shrink-0 p-0"
      onClick={handleClick}
      disabled={pending}
      title="Not this project — hide from this workbench"
      aria-label="Detach recording from this project"
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <MinusCircle className="size-3" />
      )}
    </Button>
  );
}
