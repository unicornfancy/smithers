"use client";

import { Loader2, Play, Save } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { updateScheduleAction } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  initial: {
    enabled: boolean;
    time: string;
  };
}

export function ScheduleCard({ initial }: Props) {
  const [draft, setDraft] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const dirty =
    draft.enabled !== initial.enabled || draft.time !== initial.time;

  async function handleSave() {
    if (!/^\d{2}:\d{2}$/.test(draft.time)) {
      toast.error("Time must be HH:MM in 24-hour format");
      return;
    }
    setSaving(true);
    try {
      const result = await updateScheduleAction({
        daily_briefing_enabled: draft.enabled,
        daily_briefing_time: draft.time,
      });
      if (result.ok) {
        toast.success(
          "Saved. Restart the dev server to (re-)register the cron.",
        );
      } else {
        toast.error(result.reason);
      }
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/agents/briefing", { method: "POST" });
      const body = (await res.json()) as {
        top_three: { ok: boolean; cached?: boolean; error?: string };
        realistic_shape: { ok: boolean; cached?: boolean; error?: string };
      };
      const t = body.top_three.ok ? "ok" : `failed (${body.top_three.error ?? ""})`;
      const r = body.realistic_shape.ok
        ? "ok"
        : `failed (${body.realistic_shape.error ?? ""})`;
      setLastResult(`top-three: ${t}, realistic-shape: ${r}`);
      if (body.top_three.ok && body.realistic_shape.ok) {
        toast.success("Briefing pre-warmed");
      } else {
        toast.error("Briefing finished with errors — see status below");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Daily briefing schedule</CardTitle>
        <p className="text-muted-foreground text-xs">
          Pre-warms the Top 3 + Realistic Shape cards on /today so the
          morning open is instant. In-process cron — only runs while
          the dev server is up. (For firing when dev is down, see the
          launchd plist template in <code className="bg-muted rounded px-1">scripts/launchd/</code>.)
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) =>
              setDraft((d) => ({ ...d, enabled: e.target.checked }))
            }
            className="accent-foreground"
          />
          Enable daily briefing pre-warm
        </label>

        <label className="flex items-center gap-3 text-sm">
          <span className="text-foreground text-xs font-medium">Time</span>
          <input
            type="time"
            value={draft.time}
            disabled={!draft.enabled}
            onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))}
            className={cn(
              "border-input bg-background focus-visible:ring-ring",
              "h-8 rounded-md border px-2 text-sm tabular-nums",
              "focus-visible:outline-none focus-visible:ring-1",
              "disabled:opacity-60",
            )}
          />
          <span className="text-muted-foreground text-xs">
            local time (24h)
          </span>
        </label>

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={runNow}
            disabled={running}
            className="gap-1.5"
          >
            {running ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            Run now
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            size="sm"
            className="gap-1.5"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save schedule
          </Button>
        </div>

        {lastResult ? (
          <p className="text-muted-foreground border-t pt-2 text-[11px]">
            Last run: {lastResult}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
