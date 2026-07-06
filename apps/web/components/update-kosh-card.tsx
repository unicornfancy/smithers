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
      branch?: string;
      latest?: string;
      new_commits?: number;
      message: string;
    }
  | {
      ok: false;
      reason: string;
      message: string;
    };

/**
 * Sibling of UpdateSmithersCard for the Kosh clone. Runs
 * `git pull --ff-only origin <current-branch>` in `paths.kosh` so a
 * new Kosh release lands without dropping to a terminal.
 *
 * The existing maybeUpdateKosh in kosh.ts auto-pulls before every QA
 * run, so most users never need this button; it's for the case where
 * you know a Kosh release just landed and want the new logic loaded
 * before you launch the next audit.
 */
export function UpdateKoshCard() {
  const [pending, setPending] = React.useState(false);
  const [head, setHead] = React.useState<string | null>(null);
  const [branch, setBranch] = React.useState<string | null>(null);
  const [notConfigured, setNotConfigured] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<UpdateResponse | null>(
    null,
  );

  React.useEffect(() => {
    fetch("/api/dev/kosh-update", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        if (body?.ok) {
          setHead(body.head ?? null);
          setBranch(body.branch ?? null);
        } else if (body?.reason === "no-kosh-path") {
          setNotConfigured(true);
        }
      })
      .catch(() => {});
  }, []);

  async function update() {
    setPending(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/dev/kosh-update", { method: "POST" });
      const body = (await res.json()) as UpdateResponse;
      setLastResult(body);
      if (body.ok) {
        if (body.changed) {
          toast.success(body.message);
        } else {
          toast.info(body.message);
        }
        fetch("/api/dev/kosh-update", { cache: "no-store" })
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
          Update Kosh
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Pulls the latest Kosh from{" "}
          <code className="font-mono">origin/&lt;current-branch&gt;</code>{" "}
          (fast-forward only). Kosh already auto-pulls before every QA run —
          use this when you know a release just landed and want it loaded
          before the next audit. Restart isn&apos;t required; Kosh logic
          loads fresh per run.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {notConfigured ? (
          <p className="text-muted-foreground text-xs">
            Not configured — set{" "}
            <code className="font-mono">paths.kosh</code> in
            <code className="font-mono"> config.local.yaml</code> to enable.
          </p>
        ) : head ? (
          <p className="text-muted-foreground text-xs">
            Current:{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
              {head}
            </code>
            {branch ? (
              <span className="text-muted-foreground/70 ml-2">
                · on {branch}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Reading current Kosh commit&hellip;
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={update}
          disabled={pending || notConfigured}
          className="w-fit gap-1.5"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <GitMerge className="size-3.5" />
          )}
          {pending ? "Pulling…" : "Pull latest Kosh"}
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
              <p>New Kosh logic takes effect on the next QA run.</p>
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
