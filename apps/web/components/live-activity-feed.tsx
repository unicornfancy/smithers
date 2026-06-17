"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  ExternalLink,
  FileText,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Hash,
  LifeBuoy,
  MessageSquare,
  Sparkles,
  Square,
  X,
} from "lucide-react";

import type {
  ActivityEvent,
  ActivitySource,
  SourceResult,
} from "@smithers/mcp-client";

import { cn } from "@/lib/utils";
import { AddTaskFromActivityButton } from "@/components/add-task-from-activity-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResolveFollowUpButton } from "@/components/resolve-follow-up-button";
import { SnoozeFollowUpButton } from "@/components/snooze-follow-up-button";
import { WatchForReplyDialog } from "@/components/watch-for-reply-dialog";

import type { LinkedFollowUpMap } from "@/app/projects/[slug]/page";

interface LiveActivityFeedProps {
  result: SourceResult<ActivityEvent[]>;
  /** Source-id chips rendered in the header (e.g. ["GitHub", "Slack"]). */
  configured: { label: string; configured: boolean; reason?: string }[];
  /** Cross-reference map from source_ref to linked follow-up + activity flag. */
  linkedFollowUps?: LinkedFollowUpMap;
  projectSlug?: string;
  projectName?: string;
}

const SOURCE_BY_LABEL: Record<string, ActivitySource> = {
  Slack: "slack",
  GitHub: "github",
  Linear: "linear",
  Zendesk: "zendesk",
  P2: "p2",
  wpcom: "wpcom",
  GDrive: "google_drive",
};

export function LiveActivityFeed({
  result,
  configured,
  linkedFollowUps,
  projectSlug,
  projectName,
}: LiveActivityFeedProps) {
  const events = result.ok ? result.data : (result.cachedData ?? []);
  const isMock = events.some((e) => e.is_mock);
  const freshnessLabel = describeFreshness(result);

  // Per-source event counts for chip labels — gives the user a hint
  // before clicking which filters will actually return rows.
  const countsBySource = React.useMemo(() => {
    const m = new Map<ActivitySource, number>();
    for (const e of events) m.set(e.source, (m.get(e.source) ?? 0) + 1);
    return m;
  }, [events]);

  const [selected, setSelected] = React.useState<Set<ActivitySource>>(
    () => new Set(),
  );

  function toggle(src: ActivitySource) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  }

  const filtered =
    selected.size === 0
      ? events
      : events.filter((e) => selected.has(e.source));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="text-muted-foreground size-4" />
          Live activity
          <span className="text-muted-foreground text-xs font-normal">
            ·{" "}
            {selected.size === 0
              ? events.length
              : `${filtered.length} / ${events.length}`}
          </span>
          <span
            className="text-muted-foreground/70 ml-auto text-xs font-normal"
            suppressHydrationWarning
          >
            {freshnessLabel}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!result.ok ? (
          <DegradedNotice
            message={result.error.message}
            hasCache={!!result.cachedData}
          />
        ) : null}
        {isMock ? <MockNotice /> : null}
        <ul className="flex flex-wrap items-center gap-1.5">
          {configured.map((s) => {
            const sourceKey = SOURCE_BY_LABEL[s.label];
            const count = sourceKey ? (countsBySource.get(sourceKey) ?? 0) : 0;
            const isSelected = sourceKey ? selected.has(sourceKey) : false;
            const clickable = !!sourceKey;
            return (
              <li key={s.label}>
                <button
                  type="button"
                  onClick={() => sourceKey && toggle(sourceKey)}
                  disabled={!clickable}
                  aria-pressed={isSelected}
                  title={s.reason}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected
                      ? "bg-foreground text-background"
                      : s.configured
                        ? "bg-emerald-100/60 text-emerald-900 hover:bg-emerald-200/70 dark:bg-emerald-900/30 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    !clickable && "cursor-default opacity-70",
                  )}
                >
                  {s.label}
                  {count > 0 ? (
                    <span
                      className={cn(
                        "tabular-nums opacity-70",
                        isSelected && "opacity-90",
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                  {!s.configured && s.reason ? (
                    <>
                      <span className="opacity-60">·</span>
                      <span className="opacity-70">{s.reason}</span>
                    </>
                  ) : null}
                </button>
              </li>
            );
          })}
          {selected.size > 0 ? (
            <li>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]"
                title="Clear filters"
              >
                <X className="size-3" />
                Clear
              </button>
            </li>
          ) : null}
        </ul>
        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            {selected.size === 0
              ? "No recent activity matched to this project. Configure more sources in frontmatter to broaden the feed."
              : "No activity for the selected sources. Toggle a chip off or click Clear."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {filtered.map((event) => (
              <ActivityRow
                key={event.id}
                event={event}
                linkedFollowUps={linkedFollowUps}
                projectSlug={projectSlug}
                projectName={projectName}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({
  event,
  linkedFollowUps,
  projectSlug,
  projectName,
}: {
  event: ActivityEvent;
  linkedFollowUps?: LinkedFollowUpMap;
  projectSlug?: string;
  projectName?: string;
}) {
  // Whole-row link when we have a URL — bigger click target than a
  // title-only anchor and matches how Linear/GitHub/Slack feeds work.
  // Keep the timestamp outside so it doesn't underline awkwardly with
  // the rest on hover.
  const Title = event.url ? (
    <a
      href={event.url}
      target="_blank"
      rel="noreferrer"
      className="hover:text-foreground hover:underline truncate text-sm leading-snug underline-offset-2"
    >
      {event.title}
    </a>
  ) : (
    <span className="truncate text-sm leading-snug">{event.title}</span>
  );

  // Extract GitHub issue number for cross-referencing.
  // Event id format: github:{repo}:issue:{number}
  const issueNumberMatch =
    (event.kind === "issue-opened" || event.kind === "issue-closed") &&
    event.source === "github"
      ? event.id.match(/:issue:(\d+)$/)
      : null;
  const issueNumber = issueNumberMatch ? issueNumberMatch[1]! : null;
  const linkedFollowUp = issueNumber ? linkedFollowUps?.get(issueNumber) : undefined;

  return (
    <li className="group flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        <span className="text-muted-foreground mt-0.5 shrink-0">
          <ActivityIcon event={event} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline gap-1.5">
            {event.actor ? (
              <span
                className={cn(
                  "text-foreground shrink-0 text-sm font-medium",
                  event.actor.is_external && "text-amber-700 dark:text-amber-400",
                )}
              >
                {event.actor.name}
              </span>
            ) : null}
            {event.actor?.is_external ? (
              <Badge
                variant="outline"
                className="h-4 shrink-0 border-amber-500/40 px-1 text-[9px] font-normal uppercase text-amber-700 dark:text-amber-400"
              >
                partner
              </Badge>
            ) : null}
            {Title}
            {event.url ? (
              <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
            ) : null}
          </div>
          <p className="text-muted-foreground truncate text-[11px]">
            <SourceLabel source={event.source} />
            {event.excerpt ? <> · {event.excerpt}</> : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <AddTaskFromActivityButton
            event={event}
            projectSlug={
              projectSlug ??
              (event.project_match?.in_vault
                ? event.project_match.project_slug
                : "") ??
              ""
            }
            projectName={
              projectName ?? event.project_match?.display_label ?? undefined
            }
          />
          <span
            className="text-muted-foreground/80 mt-0.5 text-[11px] tabular-nums"
            suppressHydrationWarning
          >
            {formatRelative(event.timestamp)}
          </span>
        </div>
      </div>
      {issueNumber && projectSlug && projectName ? (
        <IssueFollowUpInline
          issueNumber={issueNumber}
          issueTitle={event.title ?? ""}
          linkedFollowUp={linkedFollowUp}
          projectSlug={projectSlug}
          projectName={projectName}
        />
      ) : null}
    </li>
  );
}

function IssueFollowUpInline({
  issueNumber,
  issueTitle,
  linkedFollowUp,
  projectSlug,
  projectName,
}: {
  issueNumber: string;
  issueTitle: string;
  linkedFollowUp?: import("@/app/projects/[slug]/page").LinkedFollowUpEntry;
  projectSlug: string;
  projectName: string;
}) {
  if (!linkedFollowUp) {
    return (
      <div className="pl-6">
        <WatchForReplyDialog
          projectSlug={projectSlug}
          projectName={projectName}
          sourceType="github"
          sourceRef={issueNumber}
          defaultTask={`Follow up on #${issueNumber}${issueTitle ? ` — ${issueTitle}` : ""}`}
        />
      </div>
    );
  }

  const { has_activity, follow_up_by, follow_up_id, task } = linkedFollowUp;

  if (has_activity) {
    return (
      <div className="ml-6 flex items-center gap-2 rounded border border-amber-500/40 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <span className="flex-1">Response detected — resolve this follow-up?</span>
        <ResolveFollowUpButton
          projectSlug={projectSlug}
          followUpId={follow_up_id}
          label={task}
          alwaysVisible
        />
        <SnoozeFollowUpButton
          projectSlug={projectSlug}
          followUpId={follow_up_id}
          label={task}
          alwaysVisible
        />
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = follow_up_by
    ? Math.ceil((Date.parse(follow_up_by) - Date.parse(today)) / 86_400_000)
    : null;
  const dueText = follow_up_by
    ? daysLeft !== null && daysLeft < 0
      ? `due ${follow_up_by} · ${Math.abs(daysLeft)}d overdue`
      : `due ${follow_up_by} · ${daysLeft}d left`
    : "no due date";

  return (
    <p className="text-muted-foreground pl-6 text-[11px]">
      Watching for reply · {dueText}
    </p>
  );
}

function ActivityIcon({ event }: { event: ActivityEvent }) {
  switch (event.kind) {
    case "commit":
      return <GitCommit className="size-3.5" />;
    case "pr-opened":
      return <GitPullRequest className="size-3.5" />;
    case "pr-merged":
      return <GitMerge className="size-3.5" />;
    case "linear-issue-created":
    case "linear-issue-updated":
    case "linear-issue-completed":
      return <Square className="size-3.5" />;
    case "p2-post":
    case "p2-comment":
    case "p2-mention":
      return <Sparkles className="size-3.5" />;
    case "zendesk-ticket":
    case "zendesk-comment":
      return <LifeBuoy className="size-3.5" />;
    case "drive-file":
      return <FileText className="size-3.5" />;
    default:
      return <MessageSquare className="size-3.5" />;
  }
}

function SourceLabel({ source }: { source: ActivitySource }) {
  const map: Record<ActivitySource, string> = {
    slack: "Slack",
    github: "GitHub",
    linear: "Linear",
    zendesk: "Zendesk",
    p2: "P2",
    wpcom: "wpcom",
    google_drive: "Drive",
  };
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1">
      <Hash className="size-2.5 opacity-50" />
      {map[source]}
    </span>
  );
}

function MockNotice() {
  return (
    <div className="bg-muted/40 text-muted-foreground rounded-md border border-dashed p-2 text-[11px]">
      Demo data — wire ContextA8C to see real activity. Same project + same day
      generates the same mock events so screenshots stay stable.
    </div>
  );
}

function DegradedNotice({
  message,
  hasCache,
}: {
  message: string;
  hasCache: boolean;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50 p-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div>
        <p className="font-medium">Activity feed is degraded</p>
        <p className="opacity-80">
          {message}
          {hasCache ? " Showing the last-known cached results." : null}
        </p>
      </div>
    </div>
  );
}

function describeFreshness(result: SourceResult<ActivityEvent[]>): string {
  if (!result.ok) {
    return result.fetched_at
      ? `cached ${formatRelative(result.fetched_at)}`
      : "unavailable";
  }
  if (result.from === "fresh") return "just now";
  if (result.from === "cache") return "cached";
  return `stale · refreshing in background`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  const seconds = Math.floor((Date.now() - d.valueOf()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
