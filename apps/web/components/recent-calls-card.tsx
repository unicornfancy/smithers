import { ArrowRight, ExternalLink, PhoneCall } from "lucide-react";
import Link from "next/link";

import type { CallRecordingRef } from "@smithers/mcp-client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface RecentCallRow {
  recording: CallRecordingRef;
  matchedProjects: { slug: string; name: string }[];
}

interface Props {
  rows: RecentCallRow[];
  unmatchedCount: number;
}

export function RecentCallsCard({ rows, unmatchedCount }: Props) {
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <PhoneCall className="size-4" />
          Recent calls
          {unmatchedCount > 0 ? (
            <Badge variant="secondary" className="font-normal">
              {unmatchedCount} unmatched
            </Badge>
          ) : null}
        </CardTitle>
        <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
          <Link href="/calls">
            All <ArrowRight className="ml-1 size-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 pt-0 text-sm">
        {rows.slice(0, 5).map((row) => (
          <div
            key={row.recording.recording_id}
            className="flex items-start justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {row.recording.title ?? "(untitled)"}
              </div>
              <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                <span>{formatDate(row.recording.recorded_at)}</span>
                {row.matchedProjects.length > 0 ? (
                  <>
                    <span>·</span>
                    {row.matchedProjects.slice(0, 2).map((p, idx) => (
                      <span key={p.slug}>
                        {idx > 0 ? <span>, </span> : null}
                        <Link
                          href={`/projects/${p.slug}`}
                          className="hover:text-foreground hover:underline"
                        >
                          {p.name}
                        </Link>
                      </span>
                    ))}
                  </>
                ) : (
                  <Badge
                    variant="outline"
                    className="ml-1 px-1.5 py-0 font-normal text-amber-600 dark:text-amber-400"
                  >
                    unmatched
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              {row.recording.source_url ? (
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs"
                >
                  <a
                    href={row.recording.source_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
