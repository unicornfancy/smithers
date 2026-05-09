"use client";

import { Loader2, Save } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { updateWeeklyUpdateFormatAction } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  /** Current value of `weekly_update.format_template` from config (empty if unset). */
  initialTemplate: string;
}

const PRESETS = [
  {
    id: "per-project",
    label: "Per-project list (Katie's default)",
    template: `Use this structure:

# Weekly Update — Week {N} ({date_range})

## Last Week
* **Project Name:** what happened. Tag teammates by @handle when relevant.
* (one bullet per project that had activity OR is open and needs to be on the team's radar)
* **Meetings/Other:** roll-up of recurring meetings and one-offs not tied to a single project.

## This Week
* **Project Name:** what's planned. Tag teammates by @handle when relevant.
* (one bullet per open project)
* **Meetings/Other:** upcoming meetings and one-offs.

Tone: brief, scannable, casual professional. One short sentence or fragment per bullet — not a paragraph. Use Slack-style @handle mentions when teammates collaborated.`,
  },
  {
    id: "top-three",
    label: "Top 3 last / Top 3 next",
    template: `Use this structure:

# Weekly Update — Week {N} ({date_range})

## Top 3 last week
1. **Highlight:** what shipped, decided, or unblocked. One short paragraph.
2. **Highlight:** ditto.
3. **Highlight:** ditto.

## Top 3 this week
1. **Goal:** what you'll move forward this week.
2. **Goal:** ditto.
3. **Goal:** ditto.

Tone: short, decisive, no fluff. Each item is the most important thing you'd want a teammate skimming the thread to remember.`,
  },
  {
    id: "prioritized",
    label: "Prioritized per-project (deeper detail on top items)",
    template: `Use this structure:

# Weekly Update — Week {N} ({date_range})

## Last Week
* Sort projects by importance — top 2-3 get a paragraph each with specifics; the rest get one-line bullets.
* **Top project name** — paragraph: what happened, decisions made, blockers. Tag teammates by @handle.
* **Top project name** — paragraph: ditto.
* **Other project:** one-liner.
* (continue with one-liners for the rest)

## This Week
* Same prioritization: top 2-3 get a paragraph, rest get one-liners.
* **Top project name** — paragraph: what's planned, who you're waiting on.
* **Other project:** one-liner.

Tone: focus the reader's attention on what matters most. Give context for the top items so teammates know the state without asking; trust that the one-liners are sufficient for steady-state work.`,
  },
];

export function WeeklyUpdateFormatCard({ initialTemplate }: Props) {
  const [template, setTemplate] = React.useState(initialTemplate);
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateWeeklyUpdateFormatAction(template);
      if (result.ok) {
        toast.success(
          template.trim()
            ? "Saved custom format"
            : "Cleared override — using built-in default",
        );
      } else {
        toast.error(result.reason);
      }
    } finally {
      setSaving(false);
    }
  }

  function loadPreset(presetTemplate: string) {
    setTemplate(presetTemplate);
  }

  function clearTemplate() {
    setTemplate("");
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Weekly update format</CardTitle>
        <p className="text-muted-foreground text-xs">
          Free-form instructions handed to the agent at generate time.
          Leave blank to use the built-in default (per-project list).
          Pick a preset to load it as a starting point and edit freely.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              variant="outline"
              size="sm"
              onClick={() => loadPreset(p.template)}
              className="text-xs"
            >
              {p.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={clearTemplate}
            className="text-muted-foreground text-xs"
            disabled={!template}
          >
            Clear (use built-in)
          </Button>
        </div>

        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder="(Empty = built-in default. Or paste your own format instructions.)"
          rows={14}
          className="border-input focus-visible:ring-ring w-full resize-y rounded-md border bg-transparent p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1"
        />

        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-[11px]">
            Saves to{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono">
              weekly_update.format_template
            </code>{" "}
            in config.local.yaml.
          </p>
          <Button
            onClick={handleSave}
            disabled={saving || template === initialTemplate}
            className="gap-1.5"
            size="sm"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save format
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
