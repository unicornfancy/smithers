"use client";

import { Loader2, Play, Save } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { updateIntervalJobAction } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type JobKey =
  | "ping_monitor"
  | "transcription_sync"
  | "hive_mind_sync"
  | "team_roster_sync"
  /** Legacy alias for transcription_sync — kept so the type accepts old callers. */
  | "fathom_sync";

interface Props {
  job: JobKey;
  title: string;
  description: string;
  /** Endpoint the "Run now" button hits — typically /api/jobs/<job>. */
  runNowPath: string;
  initial: {
    enabled: boolean;
    interval_minutes: number;
  };
}

interface JobRunResponse {
  ok: boolean;
  summary?: string;
  error?: string;
  duration_ms?: number;
}

export function IntervalJobCard({
  job,
  title,
  description,
  runNowPath,
  initial,
}: Props) {
  const [draft, setDraft] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const dirty =
    draft.enabled !== initial.enabled ||
    draft.interval_minutes !== initial.interval_minutes;

  async function handleSave() {
    if (draft.interval_minutes < 1) {
      toast.error("Interval must be at least 1 minute");
      return;
    }
    setSaving(true);
    try {
      const result = await updateIntervalJobAction({
        job,
        enabled: draft.enabled,
        interval_minutes: draft.interval_minutes,
      });
      if (result.ok) {
        toast.success(
          "Saved. Restart the dev server to (re-)register the timer.",
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
      const res = await fetch(runNowPath, { method: "POST" });
      const body = (await res.json()) as JobRunResponse;
      const ms = body.duration_ms ?? 0;
      if (body.ok) {
        setLastResult(`ok · ${body.summary ?? "(no summary)"} · ${ms}ms`);
        toast.success(body.summary ?? "Job done");
      } else {
        setLastResult(`failed · ${body.error ?? "(no error message)"} · ${ms}ms`);
        toast.error(body.error ?? "Job failed");
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
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-muted-foreground text-xs">{description}</p>
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
          Enable
        </label>

        <label className="flex items-center gap-3 text-sm">
          <span className="text-foreground text-xs font-medium">Every</span>
          <input
            type="number"
            min={1}
            value={draft.interval_minutes}
            disabled={!draft.enabled}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                interval_minutes: Number(e.target.value) || d.interval_minutes,
              }))
            }
            className={cn(
              "border-input bg-background focus-visible:ring-ring",
              "h-8 w-20 rounded-md border px-2 text-sm tabular-nums",
              "focus-visible:outline-none focus-visible:ring-1",
              "disabled:opacity-60",
            )}
          />
          <span className="text-muted-foreground text-xs">minutes</span>
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
            Save
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
