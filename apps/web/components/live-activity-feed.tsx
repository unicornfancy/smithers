import * as React from "react";
import {
  Activity,
  AlertTriangle,
  ExternalLink,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Hash,
  LifeBuoy,
  MessageSquare,
  Sparkles,
  Square,
} from "lucide-react";

import type {
  ActivityEvent,
  ActivitySource,
  SourceResult,
} from "@smithers/mcp-client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface LiveActivityFeedProps {
  result: SourceResult<ActivityEvent[]>;
  /** Source-id chips rendered in the header (e.g. ["GitHub", "Slack"]). */
  configured: { label: string; configured: boolean; reason?: string }[];
}

export function LiveActivityFeed({
  result,
  configured,
}: LiveActivityFeedProps) {
  const events = result.ok ? result.data : (result.cachedData ?? []);
  const isMock = events.some((e) => e.is_mock);
  const freshnessLabel = describeFreshness(result);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="text-muted-foreground size-4" />
          Live activity
          <span className="text-muted-foreground text-xs font-normal">
            · {events.length}
          </span>
          <span className="text-muted-foreground/70 ml-auto text-xs font-normal">
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
        <ul className="flex flex-wrap gap-1.5">
          {configured.map((s) => (
            <li
              key={s.label}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]",
                s.configured
                  ? "bg-emerald-100/60 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
                  : "bg-muted text-muted-foreground",
              )}
              title={s.reason}
            >
              {s.label}
              {!s.configured && s.reason ? (
                <>
                  <span className="opacity-60">·</span>
                  <span className="opacity-70">{s.reason}</span>
                </>
              ) : null}
            </li>
          ))}
        </ul>
        {events.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            No recent activity matched to this project. Configure more sources
            in frontmatter to broaden the feed.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {events.map((event) => (
              <ActivityRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
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

  return (
    <li className="group flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
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
      <span className="text-muted-foreground/80 mt-0.5 shrink-0 text-[11px] tabular-nums">
        {formatRelative(event.timestamp)}
      </span>
    </li>
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
      return <Sparkles className="size-3.5" />;
    case "zendesk-ticket":
    case "zendesk-comment":
      return <LifeBuoy className="size-3.5" />;
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
