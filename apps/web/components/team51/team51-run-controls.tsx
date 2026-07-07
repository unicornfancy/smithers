"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, StopCircle } from "lucide-react";
import { toast } from "sonner";

import { cancelTeam51RunAction } from "@/app/projects/[slug]/team51/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  runId: string;
  projectSlug: string;
  status: "queued" | "running";
}

/**
 * Polls the detail page every 3s while the run is in flight so log
 * tail + status transitions land without the user hitting refresh.
 * Same pattern as `QaRunControls`.
 */
export function Team51RunControls({ runId, projectSlug, status }: Props) {
  const router = useRouter();
  const [cancelling, setCancelling] = React.useState(false);

  React.useEffect(() => {
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [router]);

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await cancelTeam51RunAction({
        run_id: runId,
        project_slug: projectSlug,
      });
      if (res.ok) {
        toast.success("Cancelled");
        router.refresh();
      } else {
        toast.error(res.reason);
      }
    } finally {
      setCancelling(false);
    }
  }

  return (
    <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20">
      <CardContent className="flex items-center gap-3 py-3">
        <Loader2 className="size-4 shrink-0 animate-spin text-amber-700 dark:text-amber-300" />
        <div className="flex-1">
          <p className="text-sm font-medium">
            team51 CLI {status}. This page refreshes every few seconds.
          </p>
          <p className="text-muted-foreground text-xs">
            Provisioning flows can take 30 seconds to several minutes. Safe
            to close — the run continues in the background.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCancel}
          disabled={cancelling}
          className="gap-1.5"
        >
          {cancelling ? (
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
