import { FileText } from "lucide-react";
import type { HiveMindDraft } from "@smithers/vault";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  drafts: HiveMindDraft[];
}

export function HiveMindDraftsSection({ drafts }: Props) {
  if (drafts.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4 text-muted-foreground" />
          Hive-Mind drafts
          <span className="text-muted-foreground text-xs font-normal">· {drafts.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {drafts.map((d) => (
            <li key={d.filename} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sm font-medium leading-snug truncate">
                  {d.frontmatter.title ?? d.filename.replace(/\.md$/, "")}
                </p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {d.frontmatter.date ? (
                    <span className="text-muted-foreground text-[11px] tabular-nums">
                      {d.frontmatter.date}
                    </span>
                  ) : null}
                  {d.frontmatter.type ? (
                    <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                      {d.frontmatter.type}
                    </span>
                  ) : null}
                  {d.frontmatter.status ? (
                    <DraftStatusBadge status={d.frontmatter.status} />
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function DraftStatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const styles: Record<string, string> = {
    draft: "bg-slate-100 text-slate-600 dark:bg-slate-800/50 dark:text-slate-300",
    "in-progress": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    review: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    approved: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    sent: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  };
  return (
    <span className={cn(
      "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
      styles[lower] ?? "bg-muted text-muted-foreground",
    )}>
      {status}
    </span>
  );
}
