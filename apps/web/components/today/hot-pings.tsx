import { ExternalLink, Flame } from "lucide-react";
import Link from "next/link";

import type { Ping } from "@smithers/mcp-client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  pings: Ping[];
  /** Total ping count when more exist below the fold. */
  totalCount?: number;
}

/**
 * `/today` v2 HOT-tier component. Renders the top N pings the user
 * should look at first, with prominent visual treatment (flame icon,
 * larger heading, no compact list density). Importance ranking is
 * computed upstream — see lib/server/today-signals — so this component
 * just renders what it's given. Empty pings array → component returns
 * null (don't render an empty hot zone).
 */
export function HotPings({ pings, totalCount }: Props) {
  if (pings.length === 0) return null;

  return (
    <Card className="border-orange-200/70 bg-orange-50/40 dark:border-orange-900/40 dark:bg-orange-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Flame className="size-4 text-orange-600 dark:text-orange-400" />
          Hot today
          <span className="text-muted-foreground text-xs font-normal">
            · {pings.length}
            {totalCount && totalCount > pings.length
              ? ` of ${totalCount}`
              : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-orange-200/50 dark:divide-orange-900/30">
        {pings.map((p) => (
          <div
            key={p.id}
            className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="font-normal text-[10px]">
                  {p.source}
                </Badge>
                {p.from?.is_external ? (
                  <Badge
                    variant="secondary"
                    className="font-normal text-[10px]"
                  >
                    {p.from.name ?? "partner"}
                  </Badge>
                ) : null}
                <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                  {formatRelative(p.timestamp)}
                </span>
              </div>
              <p className="line-clamp-2 text-sm leading-snug">{p.excerpt}</p>
              {p.project_match?.project_slug ? (
                <Link
                  href={`/projects/${p.project_match.project_slug}`}
                  className="text-muted-foreground hover:text-foreground text-xs hover:underline"
                >
                  {p.project_match.project_slug}
                </Link>
              ) : null}
            </div>
            {p.url ? (
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-xs hover:underline"
                aria-label="Open"
              >
                <ExternalLink className="size-3.5" />
              </a>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function formatRelative(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return "";
    const days = Math.floor(ms / 86_400_000);
    if (days >= 1) return `${days}d ago`;
    const hours = Math.floor(ms / 3_600_000);
    if (hours >= 1) return `${hours}h ago`;
    const mins = Math.floor(ms / 60_000);
    if (mins >= 1) return `${mins}m ago`;
    return "just now";
  } catch {
    return "";
  }
}
