"use client";

import * as React from "react";
import {
  ChevronRight,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Star,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import type {
  HighlightCategory,
  SuggestWeeklyHighlightsOutput,
  WeeklyHighlightSuggestion,
} from "@smithers/agents";

import {
  saveWeeklyHighlightAction,
  suggestWeeklyHighlightsAction,
} from "@/app/digest/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface HistoryRow {
  iso_week: string;
  week: number;
  relative_path: string;
  modified_at: string | null;
}

interface Props {
  isoWeek: string;
  weekNumber: number;
  initialBody: string;
  initialSavedAt: string | null;
  relativePath?: string;
  history: HistoryRow[];
}

type SuggestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "loaded";
      data: SuggestWeeklyHighlightsOutput;
      candidateCount: number;
    }
  | { kind: "no-candidates" }
  | { kind: "not-configured" }
  | { kind: "error"; message: string };

export function WeeklyHighlightCard({
  isoWeek,
  weekNumber,
  initialBody,
  initialSavedAt,
  relativePath,
  history,
}: Props) {
  const [body, setBody] = React.useState(initialBody);
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(initialSavedAt);
  const [suggestState, setSuggestState] = React.useState<SuggestState>({
    kind: "idle",
  });

  const dirty = body !== initialBody;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await saveWeeklyHighlightAction({ isoWeek, body });
      if (res.ok) {
        toast.success(
          res.changed ? "Saved" : "No changes",
        );
        setSavedAt(new Date().toISOString());
      } else {
        toast.error(res.reason);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSuggest() {
    setSuggestState({ kind: "loading" });
    const res = await suggestWeeklyHighlightsAction(isoWeek);
    if (res.ok) {
      setSuggestState({
        kind: "loaded",
        data: res.data,
        candidateCount: res.candidate_count,
      });
    } else if (res.reason === "no-candidates") {
      setSuggestState({ kind: "no-candidates" });
    } else if (res.reason === "not-configured") {
      setSuggestState({ kind: "not-configured" });
    } else {
      setSuggestState({
        kind: "error",
        message: res.message ?? "Suggestion failed",
      });
    }
  }

  function applySuggestion(pick: WeeklyHighlightSuggestion) {
    const line = `- ${pick.title}`;
    setBody((prev) => {
      const trimmed = prev.replace(/\s+$/, "");
      if (trimmed.length === 0) return line + "\n";
      return `${trimmed}\n${line}\n`;
    });
    toast.success("Added to highlight");
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Star className="size-4" />
          This week&apos;s highlight — Week {weekNumber}
          <span className="text-muted-foreground ml-auto text-xs font-normal">
            {savedAt
              ? `saved ${savedAt.slice(0, 10)}`
              : initialBody
                ? "loaded"
                : "not started"}
          </span>
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          One thing worth remembering from this week. Free-form — bullets,
          sentences, whatever. Saves to{" "}
          <code className="bg-muted rounded px-1 font-mono text-[11px]">
            {relativePath ?? `Personal Digest/${isoWeek}.md`}
          </code>
          . Personal, partner-NDA-safe — never synced to Hive Mind.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          disabled={saving}
          placeholder={`- (One thing worth remembering from Week ${weekNumber})\n- (Or several things, as bullets)`}
          className={cn(
            "border-input bg-background focus-visible:ring-ring",
            "w-full resize-y rounded-md border p-3 font-mono text-sm leading-relaxed",
            "focus-visible:outline-none focus-visible:ring-1",
          )}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="gap-1.5"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSuggest}
            disabled={suggestState.kind === "loading"}
            className="gap-1.5"
          >
            {suggestState.kind === "loading" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Wand2 className="size-3.5" />
            )}
            {suggestState.kind === "loaded" ? "Re-suggest" : "Suggest highlights"}
          </Button>
        </div>

        <SuggestionPanel
          state={suggestState}
          onApply={applySuggestion}
          onRetry={handleSuggest}
        />

        {history.length > 0 ? (
          <details className="group/history border-t pt-3">
            <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
              <ChevronRight className="size-3 transition-transform group-open/history:rotate-90" />
              History · {history.length}
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {history.slice(0, 12).map((h) => (
                <li
                  key={h.iso_week}
                  className="text-muted-foreground flex items-center gap-2"
                >
                  <span className="font-mono text-[11px] tabular-nums">
                    Week {h.week} · {h.iso_week}
                  </span>
                  <span className="text-muted-foreground/70 text-[11px]">
                    {h.modified_at ? h.modified_at.slice(0, 10) : ""}
                  </span>
                  <code className="text-muted-foreground/70 ml-auto truncate text-[10px]">
                    {h.relative_path}
                  </code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SuggestionPanel({
  state,
  onApply,
  onRetry,
}: {
  state: SuggestState;
  onApply: (pick: WeeklyHighlightSuggestion) => void;
  onRetry: () => void;
}) {
  if (state.kind === "idle") return null;
  if (state.kind === "loading") {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <Loader2 className="size-3 animate-spin" />
        Collecting candidates + ranking…
      </p>
    );
  }
  if (state.kind === "not-configured") {
    return (
      <p className="text-amber-700 dark:text-amber-300 text-xs">
        Suggestions need <code className="font-mono">ANTHROPIC_API_KEY</code>{" "}
        — set it via{" "}
        <a className="underline" href="/setup">
          /setup
        </a>
        .
      </p>
    );
  }
  if (state.kind === "no-candidates") {
    return (
      <p className="text-muted-foreground text-xs italic">
        Nothing on the signal list this week — write what stood out manually.
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-destructive">{state.message}</span>
        <button
          type="button"
          onClick={onRetry}
          className="text-muted-foreground hover:text-foreground underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="bg-muted/30 space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2 text-xs">
        <Sparkles className="size-3.5" />
        <span className="font-medium">Suggested from this week</span>
        <span className="text-muted-foreground">
          · {state.candidateCount} signal{state.candidateCount === 1 ? "" : "s"}
        </span>
      </div>
      <p className="text-muted-foreground text-xs italic">{state.data.framing}</p>
      {state.data.picks.length === 0 ? (
        <p className="text-muted-foreground text-xs italic">
          Quiet week — the agent didn&apos;t find anything strong enough to
          suggest.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {state.data.picks.map((pick, i) => (
            <li key={i} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
              <CategoryBadge category={pick.category} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">{pick.title}</p>
                <p className="text-muted-foreground text-xs leading-snug">
                  {pick.why}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onApply(pick)}
                className="h-7 shrink-0 gap-1 px-2 text-[11px]"
              >
                <Plus className="size-3" />
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CATEGORY_LABEL: Record<HighlightCategory, string> = {
  launch: "Launch",
  "urgent-response": "Fast reply",
  "brief-or-handoff": "Shipped",
  decision: "Decision",
  "sustained-engagement": "Engaged",
  "follow-up-resolved": "Resolved",
  "call-processed": "Call",
};

function CategoryBadge({ category }: { category: HighlightCategory }) {
  return (
    <span className="bg-background text-muted-foreground border-input mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
      {CATEGORY_LABEL[category]}
    </span>
  );
}
