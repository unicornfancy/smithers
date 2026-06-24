"use client";

import * as React from "react";
import { CheckCircle2, GitMerge, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type UpdateResponse =
  | {
      ok: true;
      changed: boolean;
      sha: string;
      latest?: string;
      new_commits?: number;
      deps_changed?: boolean;
      message: string;
    }
  | {
      ok: false;
      reason: string;
      message: string;
    };

/**
 * Settings → Diagnostics card that runs `git pull --rebase --ff-only
 * origin main` from the repo root so the user can pick up the latest
 * Smithers without dropping to a terminal. The API route refuses to
 * run when the working tree is dirty or the current branch isn't
 * main; in either case we surface the message verbatim.
 *
 * When dependencies changed we hint at `pnpm install`. The card
 * intentionally does NOT auto-install or auto-restart — both are
 * destructive enough that we want a deliberate user click on the
 * existing Restart card (or a terminal run for pnpm install).
 */
export function UpdateSmithersCard() {
  const [pending, setPending] = React.useState(false);
  const [head, setHead] = React.useState<string | null>(null);
  const [branch, setBranch] = React.useState<string | null>(null);
  const [lastResult, setLastResult] = React.useState<UpdateResponse | null>(
    null,
  );

  React.useEffect(() => {
    // Load current HEAD info on mount.
    fetch("/api/dev/update", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        if (body?.ok) {
          setHead(body.head ?? null);
          setBranch(body.branch ?? null);
        }
      })
      .catch(() => {
        /* swallow */
      });
  }, []);

  async function update() {
    setPending(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/dev/update", { method: "POST" });
      const body = (await res.json()) as UpdateResponse;
      setLastResult(body);
      if (body.ok) {
        if (body.changed) {
          toast.success(body.message);
        } else {
          toast.info(body.message);
        }
        // Refresh the HEAD line.
        fetch("/api/dev/update", { cache: "no-store" })
          .then((r) => r.json())
          .then((b) => {
            if (b?.ok) setHead(b.head ?? null);
          })
          .catch(() => {});
      } else {
        toast.error(body.message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      toast.error(message);
      setLastResult({ ok: false, reason: "fetch-failed", message });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitMerge className="size-4" />
          Update Smithers
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Pulls the latest from <code className="font-mono">origin/main</code>{" "}
          (fast-forward only). Refuses to run with uncommitted changes or off
          the main branch. After a successful pull you&apos;ll usually want to
          restart the dev server using the card above.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {head ? (
          <p className="text-muted-foreground text-xs">
            Current:{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
              {head}
            </code>
            {branch && branch !== "main" ? (
              <span className="text-amber-700 dark:text-amber-300 ml-2">
                · on branch {branch}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Reading current commit&hellip;
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={update}
          disabled={pending}
          className="w-fit gap-1.5"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <GitMerge className="size-3.5" />
          )}
          {pending ? "Pulling…" : "Pull latest"}
        </Button>

        {lastResult?.ok && lastResult.changed ? (
          <div className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900/50 flex items-start gap-2 rounded-md border p-3 text-xs">
            <CheckCircle2 className="size-3.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">
                Pulled {lastResult.new_commits ?? "new"} commits.
              </p>
              {lastResult.latest ? (
                <p className="font-mono text-[11px]">{lastResult.latest}</p>
              ) : null}
              {lastResult.deps_changed ? (
                <p>
                  Dependencies changed. Run{" "}
                  <code className="font-mono">pnpm install</code> in your
                  terminal, then click Restart above.
                </p>
              ) : (
                <p>Click Restart above to apply.</p>
              )}
            </div>
          </div>
        ) : null}

        {lastResult?.ok === false ? (
          <p className="text-destructive text-xs">{lastResult.message}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
