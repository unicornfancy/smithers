"use client";

import { Lightbulb, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { RealisticShapeOutput } from "@smithers/agents";

import type { RealisticShapeResponse } from "@/app/api/agents/realistic-shape/route";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  apiKeyConfigured: boolean;
  /** Cached paragraph from earlier today, if any. */
  cached?: RealisticShapeOutput;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: RealisticShapeOutput }
  | { kind: "error"; message: string; missingKey: boolean };

export function RealisticShapeCard({ apiKeyConfigured, cached }: Props) {
  const [state, setState] = useState<State>(
    cached ? { kind: "ready", data: cached } : { kind: "idle" },
  );

  async function generate() {
    if (!apiKeyConfigured) {
      toast.error(
        "Set ANTHROPIC_API_KEY in apps/web/.env.local to enable Realistic Shape.",
      );
      return;
    }
    setState({ kind: "loading" });
    try {
      // Force-bypass the day's cache — user explicitly clicked.
      const res = await fetch("/api/agents/realistic-shape?force=true", {
        method: "POST",
      });
      const json = (await res.json()) as RealisticShapeResponse;
      if (!json.ok || !json.output) {
        setState({
          kind: "error",
          message: json.error ?? "Something went wrong.",
          missingKey: json.error_kind === "missing_api_key",
        });
        return;
      }
      setState({ kind: "ready", data: json.output });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
        missingKey: false,
      });
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="text-muted-foreground size-4 shrink-0" />
            <h3 className="text-sm font-medium">Realistic shape</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground gap-1.5"
            onClick={generate}
            disabled={!apiKeyConfigured || state.kind === "loading"}
            title={
              apiKeyConfigured
                ? "Generate today's forecast paragraph"
                : "Set ANTHROPIC_API_KEY in apps/web/.env.local to enable"
            }
          >
            {state.kind === "loading" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : state.kind === "ready" ? (
              <RefreshCw className="size-3" />
            ) : (
              <Lightbulb className="size-3" />
            )}
            {state.kind === "ready" ? "Regenerate" : "Generate"}
          </Button>
        </div>

        {state.kind === "idle" ? (
          <p className="text-muted-foreground text-sm leading-snug">
            A 2-4 sentence forecast of how the day actually shapes up — capacity,
            risk, and what to defer.{" "}
            {apiKeyConfigured ? null : (
              <span>
                Set{" "}
                <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
                  ANTHROPIC_API_KEY
                </code>{" "}
                to enable.
              </span>
            )}
          </p>
        ) : null}

        {state.kind === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Drafting your forecast…
          </div>
        ) : null}

        {state.kind === "ready" ? (
          <p className="text-foreground text-sm leading-relaxed">
            {state.data.paragraph}
          </p>
        ) : null}

        {state.kind === "error" ? (
          <div className="space-y-2">
            <p className="text-destructive text-sm">{state.message}</p>
            {state.missingKey ? (
              <p className="text-muted-foreground text-xs">
                Add{" "}
                <code className="bg-muted rounded px-1 py-0.5 font-mono">
                  ANTHROPIC_API_KEY=sk-ant-…
                </code>{" "}
                to{" "}
                <code className="bg-muted rounded px-1 py-0.5 font-mono">
                  apps/web/.env.local
                </code>
                , then restart the dev server.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
