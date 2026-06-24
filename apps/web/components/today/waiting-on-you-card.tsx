import Link from "next/link";
import { ExternalLink, Inbox } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Row {
  project_slug: string;
  project_name: string;
  ticket_id: string;
  subject: string;
  ticket_url: string;
  partner_actor_name: string;
  partner_replied_at: string;
  days_waiting: number;
}

interface Props {
  rows: Row[];
}

/**
 * Cross-project rollup of Zendesk threads where the partner replied
 * last and the ticket is still in `status: open`. Top 6 inline; the
 * rest collapse behind a "see all" link to the projects list (we
 * don't have a dedicated /waiting page yet — the per-project
 * workbench's Zendesk panel surfaces the same rows in context).
 */
export function WaitingOnYouCard({ rows }: Props) {
  if (rows.length === 0) return null;
  const visible = rows.slice(0, 6);
  const hidden = rows.slice(6);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="text-muted-foreground size-4" />
          Waiting on you
          <span className="text-muted-foreground text-xs font-normal">
            · {rows.length}
          </span>
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Open Zendesk threads where the partner replied last.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {visible.map((r) => (
            <li
              key={r.ticket_id}
              className="hover:bg-muted/40 flex items-center gap-3 px-6 py-2 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">
                  <Link
                    href={`/projects/${r.project_slug}`}
                    className="hover:underline"
                  >
                    {r.subject}
                  </Link>
                </p>
                <p className="text-muted-foreground text-xs">
                  {r.project_name} · {r.partner_actor_name} ·{" "}
                  <span title={r.partner_replied_at}>
                    {formatDaysWaiting(r.days_waiting)}
                  </span>
                </p>
              </div>
              <a
                href={r.ticket_url}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground text-xs"
                aria-label={`Open Zendesk ticket ${r.ticket_id}`}
              >
                <ExternalLink className="size-3.5" />
              </a>
            </li>
          ))}
        </ul>
        {hidden.length > 0 ? (
          <p className="text-muted-foreground px-6 py-2 text-[11px]">
            + {hidden.length} more. Open the project workbench to see them.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatDaysWaiting(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
