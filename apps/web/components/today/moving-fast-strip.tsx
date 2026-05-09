import { TrendingUp } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface MovingFastEntry {
  slug: string;
  name: string;
  /** Number of activity events in the last N days. */
  count: number;
}

interface Props {
  entries: MovingFastEntry[];
  /** Window the count is over, in days. Drives the heading subtitle. */
  windowDays?: number;
}

/**
 * `/today` v2 HOT-tier "Moving fast" strip — a horizontal scroll of the
 * top N projects ranked by recent activity volume. Each chip shows
 * project name + event count and links to the workbench. Empty entries
 * → component returns null (don't render an empty strip).
 */
export function MovingFastStrip({ entries, windowDays = 7 }: Props) {
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingUp className="text-muted-foreground size-4" />
          Moving fast
          <span className="text-muted-foreground text-xs font-normal">
            · last {windowDays} days
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {entries.map((e) => (
            <Link
              key={e.slug}
              href={`/projects/${e.slug}`}
              className="border-input bg-background hover:bg-muted/50 flex shrink-0 flex-col gap-0.5 rounded-md border px-3 py-2 text-sm transition-colors"
            >
              <span className="max-w-[160px] truncate font-medium">{e.name}</span>
              <span className="text-muted-foreground text-[11px]">
                {e.count} event{e.count === 1 ? "" : "s"}
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
