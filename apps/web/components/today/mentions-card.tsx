import { AtSign, ExternalLink, Github, Square } from "lucide-react";

import type { Ping } from "@smithers/mcp-client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Row {
  ping: Ping;
  source: "linear" | "github";
}

interface Props {
  rows: Row[];
}

/**
 * @-mentions across Linear + GitHub, pulled from the existing Pings
 * to Action feed and filtered to the mention notification types.
 * Slack is deliberately excluded — partner project chatter would
 * dominate the card.
 */
export function MentionsCard({ rows }: Props) {
  if (rows.length === 0) return null;
  const visible = rows.slice(0, 6);
  const hidden = rows.slice(6);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AtSign className="text-muted-foreground size-4" />
          Mentions
          <span className="text-muted-foreground text-xs font-normal">
            · {rows.length}
          </span>
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          @-mentions in Linear and GitHub.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {visible.map((r) => (
            <li
              key={r.ping.id}
              className="hover:bg-muted/40 flex items-center gap-3 px-6 py-2 transition-colors"
            >
              <SourceIcon source={r.source} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm leading-snug">
                  {r.ping.excerpt || "(no excerpt)"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {r.ping.from.name} ·{" "}
                  <span title={r.ping.timestamp}>
                    {formatRelative(r.ping.timestamp)}
                  </span>
                </p>
              </div>
              {r.ping.url ? (
                <a
                  href={r.ping.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground text-xs"
                  aria-label="Open mention"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
        {hidden.length > 0 ? (
          <p className="text-muted-foreground px-6 py-2 text-[11px]">
            + {hidden.length} more in the Pings to Action card below.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SourceIcon({ source }: { source: "linear" | "github" }) {
  if (source === "linear") {
    return <Square className="text-muted-foreground size-3.5 shrink-0" />;
  }
  return <Github className="text-muted-foreground size-3.5 shrink-0" />;
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
