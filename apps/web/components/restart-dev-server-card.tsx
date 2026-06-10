"use client";

import * as React from "react";
import { Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type State =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "restarting"; startedAt: number; lastError?: string }
  | { kind: "back-up" };

const POLL_INTERVAL_MS = 600;
const POLL_TIMEOUT_MS = 45_000;

/**
 * Settings → Diagnostics card that kills + respawns the local
 * `pnpm dev` process so config / env-var changes take effect without
 * the user touching their terminal.
 *
 * Two-step (confirm → restart) so a stray click doesn't drop active
 * requests. While restarting, polls /api/transcription/health (any
 * non-cached server endpoint works) until the new server answers,
 * then triggers window.location.reload() so the page comes back
 * cleanly.
 */
export function RestartDevServerCard() {
  const [state, setState] = React.useState<State>({ kind: "idle" });

  async function restart() {
    setState({ kind: "restarting", startedAt: Date.now() });
    try {
      const res = await fetch("/api/dev/restart", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message =
          body?.message ?? `Restart endpoint returned ${res.status}`;
        toast.error(message);
        setState({ kind: "idle" });
        return;
      }
    } catch (err) {
      // The endpoint exits the process mid-response; on some browsers
      // that surfaces as a fetch error. Treat it as expected and
      // proceed to the poll loop.
      const message = err instanceof Error ? err.message : "Restart in flight";
      setState((prev) =>
        prev.kind === "restarting" ? { ...prev, lastError: message } : prev,
      );
    }

    await pollUntilBackUp({
      onError: (msg) =>
        setState((prev) =>
          prev.kind === "restarting" ? { ...prev, lastError: msg } : prev,
        ),
    });
    setState({ kind: "back-up" });
    toast.success("Dev server is back. Reloading…");
    setTimeout(() => window.location.reload(), 600);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <RotateCw className="size-4" />
          Restart dev server
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Picks up changes from <code className="font-mono">config.local.yaml</code>{" "}
          and{" "}
          <code className="font-mono">apps/web/.env.local</code> without you
          having to drop to a terminal. The Settings page reloads automatically
          once the new server is up (usually 5–10 seconds).
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.kind === "idle" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setState({ kind: "confirming" })}
            className="w-fit gap-1.5"
          >
            <RotateCw className="size-3.5" />
            Restart
          </Button>
        ) : null}

        {state.kind === "confirming" ? (
          <>
            <p className="text-amber-700 dark:text-amber-300 text-xs">
              Active requests + in-flight AI calls will be dropped. Continue?
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={restart}
                className="gap-1.5"
              >
                <RotateCw className="size-3.5" />
                Yes, restart
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setState({ kind: "idle" })}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : null}

        {state.kind === "restarting" ? (
          <>
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-3.5 animate-spin" />
              Killing old process, spawning a fresh `pnpm dev`…
            </p>
            <p className="text-muted-foreground text-[11px]">
              Waiting up to 45 seconds for the new server to answer. The page
              will reload automatically.
              {state.lastError ? ` (Last poll: ${state.lastError})` : ""}
            </p>
          </>
        ) : null}

        {state.kind === "back-up" ? (
          <p className="text-emerald-700 dark:text-emerald-300 text-sm">
            New server is up. Reloading…
          </p>
        ) : null}

        <p className="text-muted-foreground text-[11px]">
          Heads-up: the terminal where you ran <code>pnpm dev</code> will look
          like it's exited (its log stream stops). That's expected — the new
          process runs detached. To see logs again after the restart, you can
          re-run <code>pnpm dev</code> in a terminal whenever you want; the
          in-app restart is fine for config refreshes.
        </p>
      </CardContent>
    </Card>
  );
}

async function pollUntilBackUp(opts: { onError?: (msg: string) => void }) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      // /api/transcription/health is cheap, dynamic, and exists on
      // every install — using it as the readiness probe avoids
      // shipping a dedicated /api/dev/ping route.
      const res = await fetch("/api/transcription/health", {
        cache: "no-store",
      });
      if (res.ok) return;
      opts.onError?.(`status ${res.status}`);
    } catch (err) {
      opts.onError?.(err instanceof Error ? err.message : "no response");
    }
  }
}
