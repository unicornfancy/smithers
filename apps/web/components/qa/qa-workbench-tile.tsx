import Link from "next/link";
import { ArrowUpRight, ClipboardCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  projectSlug: string;
  totalRuns: number;
  lastRunAt: string | null;
  lastTestType: string | null;
  hasOpenIssues: boolean;
}

/**
 * Compact tile linking to /projects/<slug>/qa. Renders inline on the
 * workbench so QA runs aren't out of sight.
 */
export function QaWorkbenchTile({
  projectSlug,
  totalRuns,
  lastRunAt,
  lastTestType,
  hasOpenIssues,
}: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="size-4" />
          QA Reports
          <span className="text-muted-foreground ml-auto text-xs font-normal">
            {totalRuns} run{totalRuns === 1 ? "" : "s"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-3 pt-0">
        <div className="min-w-0 flex-1">
          {totalRuns > 0 ? (
            <p className="text-muted-foreground text-xs">
              Last: {lastTestType ?? "—"} ·{" "}
              {lastRunAt ? lastRunAt.slice(0, 16).replace("T", " ") : "—"}
              {hasOpenIssues ? " · issues outstanding" : ""}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              Run Kosh functional, performance, and accessibility audits
              against this project&apos;s dev URL. Reports archive into Hive
              Mind.
            </p>
          )}
        </div>
        <Link
          href={`/projects/${projectSlug}/qa`}
          className="text-foreground hover:bg-muted/40 inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm transition-colors"
        >
          Open
          <ArrowUpRight className="size-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
