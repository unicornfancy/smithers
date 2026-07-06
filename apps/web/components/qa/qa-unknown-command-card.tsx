"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { GitMerge, Loader2, PackageOpen } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  command: string;
}

/**
 * Fires when Kosh's clone doesn't recognize the `/kosh:<slug>`
 * Smithers invoked (typically because the user's Kosh copy is a
 * few PRs behind the version Smithers is targeting — e.g. `/kosh:aeo`
 * on a clone from before Kosh PR #10).
 *
 * Provides a one-click Update Kosh button that hits the same route
 * as the Diagnostics card. On success, tells the user to retry from
 * the launcher.
 */
export function QaUnknownCommandCard({ command }: Props) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function updateKosh() {
    setPending(true);
    try {
      const res = await fetch("/api/dev/kosh-update", { method: "POST" });
      const body = (await res.json()) as
        | { ok: true; changed: boolean; message: string; new_commits?: number }
        | { ok: false; reason: string; message: string };
      if (body.ok) {
        if (body.changed) {
          toast.success(
            `Pulled ${body.new_commits ?? "new"} commits — retry the audit from the launcher.`,
          );
        } else {
          toast.info(
            "Kosh is already up to date — the command may not be released yet.",
          );
        }
        router.refresh();
      } else {
        toast.error(body.message);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't update Kosh",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageOpen className="size-4 text-rose-700 dark:text-rose-300" />
          Kosh doesn&apos;t recognize{" "}
          <code className="rounded bg-muted px-1 font-mono text-sm">
            /kosh:{command}
          </code>
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Your local Kosh clone is out of date — the command Smithers
          invoked isn&apos;t in your version yet. Pull the latest Kosh, then
          retry the audit from the launcher.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Button
          type="button"
          size="sm"
          onClick={updateKosh}
          disabled={pending}
          className="w-fit gap-1.5"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <GitMerge className="size-3.5" />
          )}
          {pending ? "Pulling…" : "Update Kosh"}
        </Button>
        <p className="text-muted-foreground text-[11px]">
          Same as Settings → Diagnostics → Update Kosh. Runs
          <code className="mx-1 font-mono">git pull --ff-only</code> in
          your Kosh clone.
        </p>
      </CardContent>
    </Card>
  );
}
