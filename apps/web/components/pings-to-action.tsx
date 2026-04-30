import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CircleDot,
  Inbox,
  LifeBuoy,
  MessageSquare,
  Sparkles,
} from "lucide-react";

import type { Ping, SourceResult } from "@smithers/mcp-client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DismissPingButton } from "@/components/dismiss-ping-button";

interface PingsToActionProps {
  result: SourceResult<Ping[]>;
}

export function PingsToAction({ result }: PingsToActionProps) {
  const pings = result.ok ? result.data : (result.cachedData ?? []);
  const isMock = pings.some((p) => p.is_mock);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="text-muted-foreground size-4" />
          Pings to action
          <span className="text-muted-foreground text-xs font-normal">
            · {pings.length}
          </span>
          <span className="text-muted-foreground/70 ml-auto text-xs font-normal">
            {describeFreshness(result)}
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
        {isMock ? (
          <div className="bg-muted/40 text-muted-foreground rounded-md border border-dashed p-2 text-[11px]">
            Demo data — these pings are scaffolded so the &ldquo;assemble
            project context next to inbound message&rdquo; pattern (Phase 6)
            can be wired and reviewed before live MCPs are connected.
          </div>
        ) : null}
        {pings.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            No inbound pings waiting on you. Inbox zero, for now.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {pings.map((p) => (
              <PingRow key={p.id} ping={p} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PingRow({ ping }: { ping: Ping }) {
  return (
    <li className="group flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
      <span className="text-muted-foreground mt-0.5 shrink-0">
        <PingIcon source={ping.source} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              "text-foreground shrink-0 text-sm font-medium",
              ping.from.is_external && "text-amber-700 dark:text-amber-400",
            )}
          >
            {ping.from.name}
          </span>
          {ping.from.is_external ? (
            <Badge
              variant="outline"
              className="h-4 shrink-0 border-amber-500/40 px-1 text-[9px] font-normal uppercase text-amber-700 dark:text-amber-400"
            >
              partner
            </Badge>
          ) : null}
          <span className="text-muted-foreground/80 truncate text-[11px]">
            via {sourceLabel(ping.source)}
            {ping.project_match ? (
              <>
                {" · "}
                <Link
                  href={`/projects/${ping.project_match.project_slug}`}
                  className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  {ping.project_match.project_slug}
                </Link>
              </>
            ) : null}
          </span>
        </div>
        {ping.url ? (
          <a
            href={ping.url}
            target="_blank"
            rel="noreferrer"
            className="text-foreground hover:underline text-sm leading-snug underline-offset-2"
          >
            {ping.excerpt}
          </a>
        ) : (
          <p className="text-foreground text-sm leading-snug">{ping.excerpt}</p>
        )}
      </div>
      <span className="text-muted-foreground/80 mt-0.5 shrink-0 text-[11px] tabular-nums">
        {formatRelative(ping.timestamp)}
      </span>
      <DismissPingButton pingId={ping.id} label={ping.from.name} />
    </li>
  );
}

function PingIcon({ source }: { source: Ping["source"] }) {
  switch (source) {
    case "slack":
      return <MessageSquare className="size-3.5" />;
    case "p2":
      return <Sparkles className="size-3.5" />;
    case "zendesk":
      return <LifeBuoy className="size-3.5" />;
    case "linear":
      return <CircleDot className="size-3.5" />;
  }
}

function sourceLabel(source: Ping["source"]): string {
  switch (source) {
    case "slack":
      return "Slack";
    case "p2":
      return "P2";
    case "zendesk":
      return "Zendesk";
    case "linear":
      return "Linear";
  }
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
        <p className="font-medium">Pings feed is degraded</p>
        <p className="opacity-80">
          {message}
          {hasCache ? " Showing the last-known cached pings." : null}
        </p>
      </div>
    </div>
  );
}

function describeFreshness(result: SourceResult<Ping[]>): string {
  if (!result.ok) {
    return result.fetched_at
      ? `cached ${formatRelative(result.fetched_at)}`
      : "unavailable";
  }
  if (result.from === "fresh") return "just now";
  if (result.from === "cache") return "cached";
  return `stale · refreshing`;
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
