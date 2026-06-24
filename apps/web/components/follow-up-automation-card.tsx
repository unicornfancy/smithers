"use client";

import { Loader2, Save } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { updateFollowUpAutomationAction } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  initial: {
    follow_up_nudge_days: number;
    follow_up_escalate_days: number;
    follow_up_force_decide_days: number;
    next_nudge_lookahead_days: number;
    default_window_days: number;
    today_deadlines_window_days: number;
  };
}

const inputClass = cn(
  "border-input bg-background focus-visible:ring-ring",
  "h-8 w-24 rounded-md border px-2 text-sm tabular-nums",
  "focus-visible:outline-none focus-visible:ring-1",
);

export function FollowUpAutomationCard({ initial }: Props) {
  const [draft, setDraft] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const dirty = (Object.keys(draft) as (keyof typeof draft)[]).some(
    (k) => draft[k] !== initial[k],
  );

  function update<K extends keyof typeof draft>(key: K, raw: string) {
    const n = Number(raw);
    setDraft((d) => ({
      ...d,
      [key]: Number.isFinite(n) && n >= 0 ? Math.round(n) : d[key],
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateFollowUpAutomationAction(draft);
      if (result.ok) {
        toast.success("Saved follow-up settings");
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
        <CardTitle className="text-base">Follow-up automation</CardTitle>
        <p className="text-muted-foreground text-xs">
          Thresholds that drive the stalls detector on /today and the
          default <code className="bg-muted rounded px-1">follow_up_by</code>{" "}
          window when converting a To-do into a Follow-up.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h4 className="text-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
            Stall thresholds
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Nudge after"
              hint="Days since the last reply to surface a soft nudge."
              value={draft.follow_up_nudge_days}
              onChange={(v) => update("follow_up_nudge_days", v)}
            />
            <Field
              label="Escalate after"
              hint="Days before stalls switch to escalate tone."
              value={draft.follow_up_escalate_days}
              onChange={(v) => update("follow_up_escalate_days", v)}
            />
            <Field
              label="Force decide after"
              hint="Days before stalls suggest closing the loop forcibly."
              value={draft.follow_up_force_decide_days}
              onChange={(v) => update("follow_up_force_decide_days", v)}
            />
            <Field
              label="Next-nudge lookahead"
              hint="Days before a project's `next_nudge` date to surface a reminder."
              value={draft.next_nudge_lookahead_days}
              onChange={(v) => update("next_nudge_lookahead_days", v)}
            />
          </div>
        </div>

        <div>
          <h4 className="text-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
            Conversion default
          </h4>
          <Field
            label="To-do → Follow-up window"
            hint="Pre-filled `follow_up_by` value: today + N days."
            value={draft.default_window_days}
            onChange={(v) => update("default_window_days", v)}
          />
        </div>

        <div>
          <h4 className="text-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
            /today Deadlines card
          </h4>
          <Field
            label="Deadline lookahead (days)"
            hint="Linear projects with a `targetDate` within this window surface on /today. Overdue projects always surface regardless."
            value={draft.today_deadlines_window_days}
            onChange={(v) => update("today_deadlines_window_days", v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-[11px]">
            Saves to{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono">
              stall_thresholds.*
            </code>{" "}
            +{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono">
              follow_ups.default_window_days
            </code>{" "}
            in config.local.yaml.
          </p>
          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="gap-1.5"
            size="sm"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save thresholds
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (raw: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-foreground text-xs font-medium">
        {label}
        <span className="text-muted-foreground/80 ml-1.5 font-normal">
          {hint}
        </span>
      </span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
        <span className="text-muted-foreground text-xs">days</span>
      </div>
    </label>
  );
}
