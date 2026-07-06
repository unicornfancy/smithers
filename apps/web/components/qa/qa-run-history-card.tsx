import Link from "next/link";
import { ClipboardCheck, FileWarning } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type TestType = "functional-design" | "performance" | "a11y" | "aeo";
type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface Run {
  id: string;
  test_type: TestType;
  target_url: string;
  env: string;
  status: RunStatus;
  started_at: string;
  completed_at: string | null;
  counts: {
    critical: number | null;
    high: number | null;
    medium: number | null;
    low: number | null;
  };
  source: "cli" | "manual";
  has_md: boolean;
}

interface Props {
  projectSlug: string;
  runs: Run[];
}

const TEST_LABEL: Record<TestType, string> = {
  "functional-design": "Functional & design",
  performance: "Performance",
  a11y: "Accessibility",
  aeo: "AEO",
};

const STATUS_TONE: Record<RunStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  completed:
    "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  failed: "bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
  cancelled: "bg-muted text-muted-foreground",
};

export function QaRunHistoryCard({ projectSlug, runs }: Props) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="size-4" />
          History
          <span className="text-muted-foreground ml-auto text-xs font-normal">
            {runs.length} run{runs.length === 1 ? "" : "s"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {runs.length === 0 ? (
          <div className="text-muted-foreground flex items-center gap-2 px-6 py-4 text-sm">
            <FileWarning className="size-4" />
            No runs yet. Start one above.
          </div>
        ) : (
          <ul className="divide-y">
            {runs.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/projects/${projectSlug}/qa/${r.id}`}
                  className="hover:bg-muted/40 flex items-center gap-3 px-6 py-3 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {TEST_LABEL[r.test_type]}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                          STATUS_TONE[r.status],
                        )}
                      >
                        {r.status}
                      </span>
                      {r.source === "manual" ? (
                        <span className="text-muted-foreground rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                          imported
                        </span>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground truncate text-xs">
                      {r.target_url} · {r.env} · {formatTime(r.started_at)}
                    </p>
                  </div>
                  <RunCountsBadge counts={r.counts} status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RunCountsBadge({
  counts,
  status,
}: {
  counts: Run["counts"];
  status: RunStatus;
}) {
  if (status !== "completed") return null;
  const c = counts.critical ?? 0;
  const h = counts.high ?? 0;
  const m = counts.medium ?? 0;
  const l = counts.low ?? 0;
  return (
    <div className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs tabular-nums">
      <CountChip value={c} tone="rose" label="C" />
      <CountChip value={h} tone="amber" label="H" />
      <CountChip value={m} tone="zinc" label="M" />
      <CountChip value={l} tone="zinc" label="L" />
    </div>
  );
}

function CountChip({
  value,
  tone,
  label,
}: {
  value: number;
  tone: "rose" | "amber" | "zinc";
  label: string;
}) {
  if (value === 0) {
    return (
      <span className="text-muted-foreground/60 rounded px-1 text-[10px]">
        {label} 0
      </span>
    );
  }
  const className =
    tone === "rose"
      ? "bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
      : tone === "amber"
        ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "rounded px-1 text-[10px] font-semibold",
        className,
      )}
    >
      {label} {value}
    </span>
  );
}

function formatTime(iso: string): string {
  // SQLite datetime('now') stores "YYYY-MM-DD HH:MM:SS" UTC. Render the
  // date portion only for now; detail page shows full timestamp.
  return iso.slice(0, 16).replace("T", " ");
}
