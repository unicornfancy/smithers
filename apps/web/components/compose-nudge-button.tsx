"use client";

import { Copy, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ComposeNudgeResponse } from "@/app/api/agents/compose-followup-nudge/route";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  followUpId: string;
  /** Pre-warmed status so we can grey the button out when no API key is set. */
  apiKeyConfigured: boolean;
  /**
   * Force a specific tone instead of letting the agent decide. Used by the
   * Stalls card to map severity to tone (escalate → direct, force-decide →
   * force-decide, etc.).
   */
  toneOverride?: "soft" | "direct" | "force-decide";
  /** Optional label override; defaults to "Compose nudge". */
  label?: string;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: NonNullable<ComposeNudgeResponse["output"]> }
  | { kind: "error"; message: string; missingKey: boolean };

export function ComposeNudgeButton({
  followUpId,
  apiKeyConfigured,
  toneOverride,
  label = "Compose nudge",
}: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run() {
    if (!apiKeyConfigured) {
      toast.error("Set ANTHROPIC_API_KEY in .env.local to enable Compose nudge.");
      return;
    }
    setOpen(true);
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/agents/compose-followup-nudge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          follow_up_id: followUpId,
          tone_override: toneOverride,
        }),
      });
      const json = (await res.json()) as ComposeNudgeResponse;
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

  async function copyDraft() {
    if (state.kind !== "ready") return;
    const text =
      state.data.channel === "email" && state.data.subject
        ? `Subject: ${state.data.subject}\n\n${state.data.draft}`
        : state.data.draft;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't access clipboard");
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
        onClick={run}
        disabled={!apiKeyConfigured}
        title={
          apiKeyConfigured
            ? "Compose a follow-up nudge with Claude"
            : "Set ANTHROPIC_API_KEY in .env.local to enable"
        }
      >
        <Sparkles className="size-3" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Compose nudge</DialogTitle>
            <DialogDescription>
              {state.kind === "ready"
                ? `${labelForChannel(state.data.channel)} · ${labelForTone(state.data.tone)}`
                : "Drafting a nudge with Claude…"}
            </DialogDescription>
          </DialogHeader>

          {state.kind === "loading" ? <LoadingPanel /> : null}
          {state.kind === "error" ? <ErrorPanel state={state} /> : null}
          {state.kind === "ready" ? (
            <ReadyPanel data={state.data} />
          ) : null}

          <DialogFooter>
            {state.kind === "ready" ? (
              <Button size="sm" onClick={copyDraft} className="gap-1.5">
                <Copy className="size-3.5" />
                Copy
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LoadingPanel() {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Drafting…
    </div>
  );
}

function ErrorPanel({
  state,
}: {
  state: Extract<State, { kind: "error" }>;
}) {
  return (
    <div className="space-y-3 py-2 text-sm">
      <p className="text-destructive">{state.message}</p>
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
  );
}

function ReadyPanel({
  data,
}: {
  data: NonNullable<ComposeNudgeResponse["output"]>;
}) {
  return (
    <div className="space-y-4 py-2">
      {data.channel === "email" && data.subject ? (
        <div>
          <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
            Subject
          </p>
          <p className="text-sm font-medium">{data.subject}</p>
        </div>
      ) : null}
      <div>
        <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
          Draft
        </p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {data.draft}
        </p>
      </div>
      <div className="border-l-muted-foreground/30 border-l-2 pl-3">
        <p className="text-muted-foreground text-xs italic">
          {data.rationale}
        </p>
      </div>
    </div>
  );
}

function labelForChannel(channel: "email" | "slack"): string {
  return channel === "email" ? "Email" : "Slack";
}

function labelForTone(tone: "soft" | "direct" | "force-decide"): string {
  switch (tone) {
    case "soft":
      return "Soft nudge";
    case "direct":
      return "Direct";
    case "force-decide":
      return "Force a decision";
  }
}
