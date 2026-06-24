import Link from "next/link";
import { CalendarClock, ExternalLink } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Row {
  project_slug: string;
  project_name: string;
  linear_name: string;
  linear_url: string;
  target_date: string;
  days_until: number;
  health: string;
  state: string;
}

interface Props {
  rows: Row[];
  windowDays: number;
}

/**
 * Linear projects with a `targetDate` within the configured window
 * (default 14 days) plus anything already overdue. Overdue rows
 * surface first (negative days_until) — colored amber/rose so they
 * read as urgent without being shouty.
 */
export function DeadlinesCard({ rows, windowDays }: Props) {
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="text-muted-foreground size-4" />
          Deadlines
          <span className="text-muted-foreground text-xs font-normal">
            · {rows.length}
          </span>
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Linear projects with target dates in the next {windowDays} days
          (plus anything overdue).
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {rows.map((r) => (
            <li
              key={r.project_slug}
              className="hover:bg-muted/40 flex items-center gap-3 px-6 py-2 transition-colors"
            >
              <DaysChip days={r.days_until} />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">
                  <Link
                    href={`/projects/${r.project_slug}`}
                    className="hover:underline"
                  >
                    {r.project_name}
                  </Link>
                </p>
                <p className="text-muted-foreground text-xs">
                  {r.state} · target {r.target_date}
                  {r.health && r.health !== "onTrack" ? (
                    <>
                      {" · "}
                      <span className={healthClass(r.health)}>
                        {humanizeHealth(r.health)}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
              <a
                href={r.linear_url}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground text-xs"
                aria-label={`Open Linear project ${r.linear_name}`}
              >
                <ExternalLink className="size-3.5" />
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function DaysChip({ days }: { days: number }) {
  if (days < 0) {
    return (
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
          "bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
        )}
        title={`${Math.abs(days)} day(s) overdue`}
      >
        {Math.abs(days)}d late
      </span>
    );
  }
  if (days <= 2) {
    return (
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
          "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
        )}
      >
        {days === 0 ? "today" : `${days}d`}
      </span>
    );
  }
  return (
    <span className="bg-muted text-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
      {days}d
    </span>
  );
}

function humanizeHealth(health: string): string {
  if (health === "atRisk") return "at risk";
  if (health === "offTrack") return "off track";
  return health;
}

function healthClass(health: string): string {
  if (health === "offTrack")
    return "text-rose-700 dark:text-rose-300 font-medium";
  if (health === "atRisk")
    return "text-amber-700 dark:text-amber-300 font-medium";
  return "";
}
