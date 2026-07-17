"use client";

import * as React from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { updateActiveHoursAction } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  initial: {
    start: string; // "" when active-hours gate is off
    end: string;
    timezone: string;
    workdays: string[];
  };
}

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-8 rounded-md border px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-1 disabled:opacity-60";

/**
 * Settings → Workflow card for the active-hours gate. Toggle the
 * feature on with `enabled`; when off, both fields are cleared and
 * every periodic scheduler job runs any time (legacy behavior).
 * Workdays + timezone are shown read-only — those live in
 * config.local.yaml under working_rhythm and haven't grown a UI yet.
 */
export function ActiveHoursCard({ initial }: Props) {
  const gateOn = Boolean(initial.start) && Boolean(initial.end);
  const [enabled, setEnabled] = React.useState(gateOn);
  const [start, setStart] = React.useState(initial.start || "09:00");
  const [end, setEnd] = React.useState(initial.end || "17:00");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setEnabled(gateOn);
    setStart(initial.start || "09:00");
    setEnd(initial.end || "17:00");
  }, [gateOn, initial.start, initial.end]);

  const initialEnabled = gateOn;
  const dirty =
    enabled !== initialEnabled ||
    (enabled && (start !== initial.start || end !== initial.end));

  async function handleSave() {
    if (enabled) {
      if (!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) {
        toast.error("Start / end must be HH:MM in 24-hour format");
        return;
      }
    }
    setSaving(true);
    try {
      const result = await updateActiveHoursAction(
        enabled ? { start, end } : { start: "", end: "" },
      );
      if (result.ok) {
        toast.success("Saved. Next scheduler tick will honor the new window.");
      } else {
        toast.error(result.reason);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Active hours</CardTitle>
        <p className="text-muted-foreground text-xs">
          Gate for every periodic scheduler job (ping monitor + the sync
          jobs). Outside the window — or on a non-workday — jobs return
          &ldquo;skipped, outside active hours&rdquo; instead of calling
          the APIs. Keeps after-hours and weekend runs from burning tokens
          when you&apos;re not around to look at the results. Daily
          briefing bypasses this gate — it fires at{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            schedule.daily_briefing.time
          </code>{" "}
          regardless.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-foreground"
          />
          Only fire periodic jobs during active hours
        </label>

        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-foreground text-xs font-medium">Start</span>
            <input
              type="time"
              value={start}
              disabled={!enabled}
              onChange={(e) => setStart(e.target.value)}
              className={cn(inputClass, "w-28")}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-foreground text-xs font-medium">End</span>
            <input
              type="time"
              value={end}
              disabled={!enabled}
              onChange={(e) => setEnd(e.target.value)}
              className={cn(inputClass, "w-28")}
            />
          </label>
          <span className="text-muted-foreground text-xs">
            {initial.timezone} · 24h
          </span>
        </div>

        <p className="text-muted-foreground text-[11px]">
          Workdays:{" "}
          {(initial.workdays ?? []).length > 0
            ? initial.workdays.join(", ")
            : "(none — all jobs skipped)"}
          . Edit{" "}
          <code className="bg-muted rounded px-1 py-0.5">
            working_rhythm.workdays
          </code>{" "}
          in{" "}
          <code className="bg-muted rounded px-1 py-0.5">
            config.local.yaml
          </code>{" "}
          if that&apos;s wrong.
        </p>

        <div className="flex items-center justify-end gap-3 border-t pt-3">
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
      </CardContent>
    </Card>
  );
}
