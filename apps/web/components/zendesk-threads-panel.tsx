import { ChevronRight, ExternalLink, LifeBuoy, Star } from "lucide-react";

import type { ZendeskTicketSummary } from "@smithers/mcp-client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ZendeskAttachModal } from "@/components/zendesk-attach-modal";

interface Props {
  projectSlug: string;
  /** Resolved ticket summaries, in the same order the user listed them. */
  tickets: ZendeskTicketSummary[];
  /**
   * Hint passed into the Attach modal as the default search query —
   * usually the partner display name so a partner workbench gets a
   * one-click "show me what's open" experience.
   */
  defaultSearchQuery?: string;
  /**
   * When true, render even with zero tickets so the user can attach
   * one. Partner workbenches always render; non-partner projects only
   * render when at least one ticket is wired up (no point cluttering
   * personal projects with an Attach button they'll never use).
   */
  alwaysShow?: boolean;
}

/**
 * Panel-format renderer for a project's Zendesk threads. The first
 * ticket is marked "primary" so the user can spot the main thread at
 * a glance even when there are several. An "Attach Zendesk thread"
 * button in the header opens a search-and-attach modal so the user
 * can wire up additional threads from the workbench without editing
 * frontmatter by hand.
 */
export function ZendeskThreadsPanel({
  projectSlug,
  tickets,
  defaultSearchQuery,
  alwaysShow,
}: Props) {
  if (tickets.length === 0 && !alwaysShow) return null;

  const existingIds = tickets.map((t) => t.id);
  const { active, closed } = partitionByStatus(tickets);
  // The "primary" badge sticks to the first ticket as listed in
  // frontmatter, regardless of status — re-ordering frontmatter is
  // how the user signals which thread is primary, not which one is
  // currently open.
  const primaryId = tickets[0]?.id;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LifeBuoy className="text-muted-foreground size-4" />
          Zendesk threads
          {tickets.length > 0 ? (
            <span className="text-muted-foreground text-xs font-normal">
              · {active.length} active
              {closed.length > 0 ? ` · ${closed.length} closed` : ""}
            </span>
          ) : null}
          <span className="ml-auto">
            <ZendeskAttachModal
              projectSlug={projectSlug}
              existingTicketIds={existingIds}
              defaultQuery={defaultSearchQuery}
            />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {tickets.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            No Zendesk threads attached yet. Use the Attach button above
            to search and pick one.
          </p>
        ) : null}
        {active.length > 0 ? (
          <ul className="flex flex-col divide-y">
            {active.map((t) => (
              <ZendeskRow key={t.id} ticket={t} primary={t.id === primaryId} />
            ))}
          </ul>
        ) : tickets.length > 0 ? (
          <p className="text-muted-foreground text-sm italic">
            No active threads — see closed below for history.
          </p>
        ) : null}
        {closed.length > 0 ? (
          // Native <details> so the disclosure works without a client
          // boundary — the rest of this panel is server-rendered, and
          // expanding closed history doesn't need React state.
          <details className="group rounded-md border border-dashed">
            <summary
              className={cn(
                "flex cursor-pointer list-none items-center gap-2 px-3 py-2",
                "text-muted-foreground text-xs font-medium",
                "hover:text-foreground",
              )}
            >
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
              Closed threads · {closed.length}
              <span className="opacity-70 ml-1.5 font-normal">
                ongoing record
              </span>
            </summary>
            <ul className="flex flex-col divide-y px-3 pb-2">
              {closed.map((t) => (
                <ZendeskRow
                  key={t.id}
                  ticket={t}
                  primary={t.id === primaryId}
                  dim
                />
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

const ACTIVE_STATUSES = new Set(["open", "pending", "new", "hold"]);
const CLOSED_STATUSES = new Set(["solved", "closed"]);

function partitionByStatus(tickets: ZendeskTicketSummary[]): {
  active: ZendeskTicketSummary[];
  closed: ZendeskTicketSummary[];
} {
  const active: ZendeskTicketSummary[] = [];
  const closed: ZendeskTicketSummary[] = [];
  for (const t of tickets) {
    const s = t.status?.toLowerCase() ?? "";
    if (CLOSED_STATUSES.has(s)) {
      closed.push(t);
    } else if (ACTIVE_STATUSES.has(s)) {
      active.push(t);
    } else {
      // Unknown / null status — treat as active so the user sees it
      // by default rather than buried under a disclosure.
      active.push(t);
    }
  }
  return { active, closed };
}

function ZendeskRow({
  ticket,
  primary,
  dim = false,
}: {
  ticket: ZendeskTicketSummary;
  primary: boolean;
  dim?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0",
        dim && "text-muted-foreground",
      )}
    >
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
          <span
            className={cn(
              "text-sm font-medium",
              dim ? "text-muted-foreground" : "text-foreground",
            )}
          >
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
