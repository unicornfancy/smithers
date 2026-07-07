"use client";

import * as React from "react";
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Tool = "op" | "gh" | "ssh";

interface Probe {
  tool: Tool;
  ok: boolean;
  message: string;
  remedy?: string;
  detail?: string;
  version?: string;
}

interface ToolsResponse {
  ok: true;
  team51: { binary: string | null; ready: boolean; reason?: string };
  tools: Probe[];
}

const TOOL_LABEL: Record<Tool, string> = {
  op: "1Password CLI (op)",
  gh: "GitHub CLI (gh)",
  ssh: "GitHub SSH",
};

/**
 * Diagnostics card that runs the same external-tool probes the
 * team51 runner uses for pre-flight. Lets the user verify auth
 * state without kicking a real provisioning command that would
 * fail seconds later.
 */
export function Team51ToolsCard() {
  const [pending, setPending] = React.useState(false);
  const [data, setData] = React.useState<ToolsResponse | null>(null);

  async function probe() {
    setPending(true);
    try {
      const res = await fetch("/api/dev/team51-tools", { cache: "no-store" });
      const body = (await res.json()) as ToolsResponse;
      setData(body);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Probe failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4" />
          Team51 CLI + external tools
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Verifies the team51 binary and the external tools it depends on:{" "}
          <code className="font-mono">op</code> (1Password),{" "}
          <code className="font-mono">gh</code> (GitHub CLI), and GitHub SSH.
          Run this if a Provisioning workflow just failed with an{" "}
          <code className="font-mono">external-auth-failed</code> card.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={probe}
          disabled={pending}
          className="w-fit gap-1.5"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="size-3.5" />
          )}
          {pending ? "Probing…" : "Test tools"}
        </Button>

        {data ? (
          <div className="space-y-2 text-xs">
            <ProbeRow
              label="team51 binary"
              ok={data.team51.ready}
              message={
                data.team51.ready
                  ? `Found at ${data.team51.binary}.`
                  : (data.team51.reason ?? "Not resolvable.")
              }
            />
            {data.tools.map((p) => (
              <ProbeRow
                key={p.tool}
                label={
                  p.version ? `${TOOL_LABEL[p.tool]} · ${p.version}` : TOOL_LABEL[p.tool]
                }
                ok={p.ok}
                message={p.message}
                remedy={p.remedy}
                detail={p.detail}
              />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProbeRow({
  label,
  ok,
  message,
  remedy,
  detail,
}: {
  label: string;
  ok: boolean;
  message: string;
  remedy?: string;
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
      ) : (
        <XCircle className="size-3.5 shrink-0 text-rose-700 dark:text-rose-300" />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-foreground font-medium">{label}</p>
        <p className="text-muted-foreground">{message}</p>
        {detail ? (
          <p className="text-muted-foreground text-[11px]">
            Raw:{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono">
              {detail}
            </code>
          </p>
        ) : null}
        {remedy ? (
          <p className="text-muted-foreground text-[11px]">Fix: {remedy}</p>
        ) : null}
      </div>
    </div>
  );
}
