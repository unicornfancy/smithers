"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, PenSquare } from "lucide-react";
import { toast } from "sonner";

import { writeCapturedUrlToFrontmatterAction } from "@/app/projects/[slug]/team51/actions";
import { Button } from "@/components/ui/button";

interface Props {
  runId: string;
  command: string;
  projectSlug: string;
}

const FIELD_HINT: Record<string, string> = {
  "wpcom:create-site": "production_url",
  "pressable:create-site": "staging_url",
  "pressable:clone-site": "staging_url",
};

/**
 * User-triggered write-back: takes the captured URL from a
 * completed run and writes it into the project's frontmatter under
 * the field appropriate for the command (production_url for WPCOM
 * production creates, staging_url for Pressable creates + clones).
 * Idempotent — server returns `not-written` if the value's already
 * set to the same URL.
 */
export function Team51WriteBackButton({ runId, command, projectSlug }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [done, setDone] = React.useState<null | {
    field: string;
    url: string;
  }>(null);

  const field = FIELD_HINT[command];
  if (!field) return null;

  function submit() {
    startTransition(async () => {
      const res = await writeCapturedUrlToFrontmatterAction({ run_id: runId });
      if (res.ok) {
        setDone(res.data);
        toast.success(`Wrote ${res.data.url} to ${res.data.field}`);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  if (done) {
    return (
      <div className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
        <CheckCircle2 className="size-3.5 text-emerald-700 dark:text-emerald-300" />
        Written to <code className="font-mono">{done.field}</code>.{" "}
        <a
          href={`/projects/${projectSlug}`}
          className="text-sky-600 dark:text-sky-400 underline-offset-2 hover:underline"
        >
          View project
        </a>
      </div>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={submit}
      disabled={pending}
      className="w-fit gap-1.5"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <PenSquare className="size-3.5" />
      )}
      Write to <code className="font-mono">{field}</code>
    </Button>
  );
}
