"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, StopCircle } from "lucide-react";
import { toast } from "sonner";

import { cancelQaRunAction } from "@/app/projects/[slug]/qa/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  runId: string;
  projectSlug: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
}

/**
 * Active-run controls on the detail page. Polls every 5s so the page
 * walks forward as the subprocess streams + completes.
 */
export function QaRunControls({ runId, projectSlug, status }: Props) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [router]);

  async function handleCancel() {
    setPending(true);
    try {
      const res = await cancelQaRunAction({ run_id: runId, project_slug: projectSlug });
      if (res.ok) {
        toast.success("Cancelled");
        router.refresh();
      } else {
        toast.error(res.reason);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20">
      <CardContent className="flex items-center gap-3 py-3">
        <Loader2 className="size-4 shrink-0 animate-spin text-amber-700 dark:text-amber-300" />
        <div className="flex-1">
          <p className="text-sm font-medium">
            Test {status}. This page refreshes every few seconds.
          </p>
          <p className="text-muted-foreground text-xs">
            Kosh runs typically take 30 seconds to several minutes. Safe to
            close — it&apos;ll keep going.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCancel}
          disabled={pending}
          className="gap-1.5"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <StopCircle className="size-3.5" />
          )}
          Cancel
        </Button>
      </CardContent>
    </Card>
  );
}
