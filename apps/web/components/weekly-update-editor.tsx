"use client";

import {
  CalendarDays,
  Copy,
  ExternalLink,
  Loader2,
  Save,
  Sparkles,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  generateWeeklyUpdateAction,
  saveWeeklyUpdateAction,
} from "@/app/weekly-updates/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import type { WeeklyFacts } from "@/lib/server/weekly-facts";
import type { TeamWeeklyPostResult } from "@/lib/server/team-weekly-post";

interface Props {
  isoWeek: string;
  weekStart: string;
  weekEnd: string;
  teamPost: TeamWeeklyPostResult;
  /** Existing saved body (if the user already drafted this week's update). */
  initialBody: string;
  apiKeyConfigured: boolean;
}

export function WeeklyUpdateEditor({
  isoWeek,
  weekStart,
  weekEnd,
  teamPost,
  initialBody,
  apiKeyConfigured,
}: Props) {
  const [body, setBody] = React.useState(initialBody);
  const [facts, setFacts] = React.useState<WeeklyFacts | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [userNotes, setUserNotes] = React.useState("");
  const [showPreview, setShowPreview] = React.useState(false);

  async function handleGenerate() {
    if (!apiKeyConfigured) {
      toast.error("Set ANTHROPIC_API_KEY in .env.local to generate.");
      return;
    }
    setGenerating(true);
    try {
      const result = await generateWeeklyUpdateAction(
        isoWeek,
        userNotes ? { user_notes: userNotes } : undefined,
      );
      if (!result.ok) {
        toast.error(result.message ?? result.reason);
        return;
      }
      setBody(result.data.body);
      setFacts(result.facts);
      toast.success(
        `Drafted from ${result.facts.projects.length} project${result.facts.projects.length === 1 ? "" : "s"}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!body.trim()) {
      toast.error("Nothing to save.");
      return;
    }
    setSaving(true);
    try {
      const result = await saveWeeklyUpdateAction({ iso_week: isoWeek, body });
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success(`Saved to ${result.relative_path}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(body);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CalendarDays className="text-muted-foreground size-4" />
            {isoWeek} · {weekStart} → {weekEnd}
            <span className="text-muted-foreground/70 ml-auto text-xs font-normal">
              <TeamPostLink result={teamPost} />
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <textarea
            value={userNotes}
            onChange={(e) => setUserNotes(e.target.value)}
            placeholder="Optional notes for this run (e.g. 'AFK Mon-Wed next week', 'mention shareable launch'). The agent reads these alongside the auto-collected facts."
            rows={2}
            className="border-input focus-visible:ring-ring w-full resize-none rounded-md border bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generating}
              className="gap-1.5"
            >
              {generating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {generating ? "Generating…" : body ? "Regenerate" : "Generate"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSave}
              disabled={saving || !body.trim()}
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
              size="sm"
              variant="ghost"
              onClick={handleCopy}
              disabled={!body.trim()}
              className="gap-1.5"
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowPreview((p) => !p)}
              className="ml-auto"
            >
              {showPreview ? "Edit" : "Preview"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Draft</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {showPreview ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                {body ? (
                  <Markdown source={body} />
                ) : (
                  <p className="text-muted-foreground italic">
                    No draft yet — click Generate.
                  </p>
                )}
              </div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={
                  apiKeyConfigured
                    ? "Click Generate to draft from this week's activity, or paste your own."
                    : "Set ANTHROPIC_API_KEY in .env.local to enable Generate. You can still edit and save manually."
                }
                rows={32}
                className="border-input focus-visible:ring-ring w-full resize-y rounded-md border bg-transparent p-3 font-mono text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-1"
              />
            )}
          </CardContent>
        </Card>

        <FactsPanel facts={facts} />
      </div>
    </div>
  );
}

function TeamPostLink({ result }: { result: TeamWeeklyPostResult }) {
  if (result.kind === "not-configured") {
    return (
      <span className="text-muted-foreground/60">
        team P2 not configured
      </span>
    );
  }
  if (!result.url) return null;
  const label =
    result.kind === "found"
      ? "This week's P2 post"
      : "Team P2 (find Monday's post)";
  return (
    <a
      href={result.url}
      target="_blank"
      rel="noreferrer"
      className="hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
      title={result.title ?? result.url}
    >
      <ExternalLink className="size-3" />
      {label}
    </a>
  );
}

function FactsPanel({ facts }: { facts: WeeklyFacts | null }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Facts
          {facts ? (
            <span className="text-muted-foreground ml-1.5 text-xs font-normal">
              · {facts.projects.length} project
              {facts.projects.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {!facts ? (
          <p className="text-muted-foreground text-xs italic">
            Click Generate to collect this week's per-project activity. The
            facts feed the agent's draft and stay visible here so you can
            cross-check the prose.
          </p>
        ) : facts.projects.length === 0 ? (
          <p className="text-muted-foreground text-xs italic">
            No partner / team projects in scope.
          </p>
        ) : (
          facts.projects.map((p) => (
            <div key={p.slug} className="space-y-1">
              <p className="text-foreground text-xs font-medium">{p.name}</p>
              <ul className="text-muted-foreground space-y-0.5 text-[11px]">
                {p.events.length > 0 ? (
                  <li>
                    {p.events.length} activity event
                    {p.events.length === 1 ? "" : "s"}
                  </li>
                ) : null}
                {p.linearUpdates.length > 0 ? (
                  <li>
                    {p.linearUpdates.length} Linear update
                    {p.linearUpdates.length === 1 ? "" : "s"}
                  </li>
                ) : null}
                {p.recentCalls.length > 0 ? (
                  <li>
                    {p.recentCalls.length} call
                    {p.recentCalls.length === 1 ? "" : "s"}:{" "}
                    {p.recentCalls.map((c) => c.title).join(", ")}
                  </li>
                ) : null}
                {p.recentDrafts.length > 0 ? (
                  <li>
                    {p.recentDrafts.length} draft
                    {p.recentDrafts.length === 1 ? "" : "s"}
                  </li>
                ) : null}
                {p.events.length === 0 &&
                p.linearUpdates.length === 0 &&
                p.recentCalls.length === 0 &&
                p.recentDrafts.length === 0 ? (
                  <li className="italic">no activity this week</li>
                ) : null}
              </ul>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
