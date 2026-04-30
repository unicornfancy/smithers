import { ExternalLink, LifeBuoy, Star } from "lucide-react";

import type { ZendeskTicketSummary } from "@smithers/mcp-client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  /** Resolved ticket summaries, in the same order the user listed them. */
  tickets: ZendeskTicketSummary[];
}

/**
 * Panel-format renderer for a project's Zendesk threads. Renders
 * nothing when the list is empty so partner workbenches without
 * tickets stay clean. The first ticket is marked "primary" so the
 * user can spot the main thread at a glance even when there are
 * several.
 */
export function ZendeskThreadsPanel({ tickets }: Props) {
  if (tickets.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LifeBuoy className="text-muted-foreground size-4" />
          Zendesk threads
          <span className="text-muted-foreground text-xs font-normal">
            · {tickets.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {tickets.map((t, i) => (
            <ZendeskRow key={t.id} ticket={t} primary={i === 0} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ZendeskRow({
  ticket,
  primary,
}: {
  ticket: ZendeskTicketSummary;
  primary: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {primary ? (
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
              title="Primary thread"
            >
              <Star className="size-2.5" />
              primary
            </span>
          ) : null}
          <span className="text-foreground text-sm font-medium">
            {ticket.subject ?? `Ticket #${ticket.id}`}
          </span>
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          <code className="font-mono">#{ticket.id}</code>
          {ticket.status ? (
            <StatusBadge status={ticket.status} />
          ) : (
            <span className="italic">status unknown</span>
          )}
          {ticket.priority && ticket.priority !== "normal" ? (
            <span className="capitalize">{ticket.priority}</span>
          ) : null}
          {ticket.updated_at ? (
            <span className="tabular-nums">
              updated {formatRelative(ticket.updated_at)}
            </span>
          ) : null}
        </div>
      </div>
      <a
        href={ticket.url}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-xs underline-offset-2 hover:underline"
      >
        Open
        <ExternalLink className="size-3" />
      </a>
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes = cn(
    "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
    statusColor(status),
  );
  return <span className={classes}>{status}</span>;
}

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "open":
    case "new":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400";
    case "pending":
    case "hold":
      return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
    case "solved":
    case "closed":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
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
