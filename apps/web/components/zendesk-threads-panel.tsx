import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  LifeBuoy,
  Star,
} from "lucide-react";

import type {
  ActivityEvent,
  ZendeskTicketSummary,
} from "@smithers/mcp-client";
import type { FollowUp } from "@smithers/vault";

import type { LinkedFollowUpMap } from "@/app/projects/[slug]/page";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConvertFollowUpToTaskButton } from "@/components/convert-follow-up-to-task-button";
import { DraftFollowUpNudgeButton } from "@/components/draft-follow-up-nudge-button";
import { DraftZendeskReplyButton } from "@/components/draft-zendesk-reply-button";
import { MakePrimaryButton } from "@/components/make-primary-button";
import { RefreshZendeskMetadataButton } from "@/components/refresh-zendesk-metadata-button";
import { ResolveFollowUpButton } from "@/components/resolve-follow-up-button";
import { SnoozeFollowUpButton } from "@/components/snooze-follow-up-button";
import { WatchForReplyDialog } from "@/components/watch-for-reply-dialog";
import { ZendeskAttachModal } from "@/components/zendesk-attach-modal";
import { ZendeskSearchSettingsModal } from "@/components/zendesk-search-settings-modal";

interface Props {
  projectSlug: string;
  /** Resolved ticket summaries, in the same order the user listed them. */
  tickets: ZendeskTicketSummary[];
  /**
   * Search hints used by the Refresh button to backfill metadata
   * for tickets stored as bare ids. Usually [partner display name,
   * deslug'd partner, project name].
   */
  refreshHints: string[];
  /** Persisted user-curated search terms (frontmatter zendesk_search_terms). */
  savedSearchTerms: string[];
  /**
   * All follow-ups for this project (active + resolved). The panel
   * groups them by referenced #ticket_id and renders matched ones
   * under each ticket; unmatched ones land in the "Unattributed"
   * section at the bottom.
   */
  followUps: { active: FollowUp[]; resolved: FollowUp[] };
  /**
   * Map of ticket id → most-recent comments. Used to populate the
   * per-ticket "Recent activity" disclosure. Empty array (or missing
   * key) is fine — disclosure just stays empty.
   */
  recentActivityByTicketId?: Record<string, ActivityEvent[]>;
  /** Default query for the Attach modal — usually the partner name. */
  defaultSearchQuery?: string;
  /**
   * When true, render even with zero tickets. Partner workbenches
   * always render; non-partner projects only render when at least one
   * ticket is wired up.
   */
  alwaysShow?: boolean;
  /**
   * Cross-reference map from source_ref (ticket id) to the linked follow-up
   * plus whether a response has been detected. When present, each ticket row
   * shows an inline follow-up status or a "Watch" affordance.
   */
  linkedFollowUps?: LinkedFollowUpMap;
  /** Project display name — passed through to WatchForReplyDialog. */
  projectName?: string;
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
  refreshHints,
  savedSearchTerms,
  followUps,
  recentActivityByTicketId,
  defaultSearchQuery,
  alwaysShow,
  linkedFollowUps,
  projectName,
}: Props) {
  const hasTickets = tickets.length > 0;
  const allFollowUps = [...followUps.active, ...followUps.resolved];
  if (tickets.length === 0 && allFollowUps.length === 0 && !alwaysShow)
    return null;

  const existingIds = tickets.map((t) => t.id);
  const { active, closed } = partitionByStatus(tickets);
  const primaryId = tickets[0]?.id;
  const primaryIsClosed =
    primaryId !== undefined &&
    closed.some((t) => t.id === primaryId);
  // Suggest the first active ticket as the new primary when current primary
  // is closed. Drives the cleanup banner at the top of the panel.
  const suggestedPrimary = primaryIsClosed ? active[0] : undefined;
  // Group follow-ups by referenced #ticket_id. A follow-up that mentions
  // multiple ids gets attributed to the first one (rare in practice).
  // What's left over goes in the Unattributed bucket at the bottom.
  const { byTicket: followUpsByTicket, unattributed } = groupFollowUpsByTicket(
    allFollowUps,
  );

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
          <span className="ml-auto flex items-center gap-1.5">
            <ZendeskSearchSettingsModal
              projectSlug={projectSlug}
              initialTerms={savedSearchTerms}
            />
            {hasTickets ? (
              <RefreshZendeskMetadataButton
                projectSlug={projectSlug}
                hints={refreshHints}
              />
            ) : null}
            <ZendeskAttachModal
              projectSlug={projectSlug}
              existingTicketIds={existingIds}
              defaultQuery={defaultSearchQuery}
            />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {tickets.length === 0 && unattributed.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            No Zendesk threads attached yet. Use the Attach button above
            to search and pick one.
          </p>
        ) : null}
        {suggestedPrimary ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50 p-2 text-[12px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span>
                Primary thread is closed. Promote{" "}
                <span className="font-medium">
                  {suggestedPrimary.subject ?? `#${suggestedPrimary.id}`}
                </span>
                ?
              </span>
              <span className="ml-auto">
                <MakePrimaryButton
                  projectSlug={projectSlug}
                  ticketId={suggestedPrimary.id}
                  ticketLabel={
                    suggestedPrimary.subject ?? `#${suggestedPrimary.id}`
                  }
                />
              </span>
            </div>
          </div>
        ) : null}
        {active.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {active.map((t) => (
              <ThreadCard
                key={t.id}
                projectSlug={projectSlug}
                projectName={projectName}
                ticket={t}
                primary={t.id === primaryId}
                followUps={followUpsByTicket.get(t.id) ?? []}
                recentActivity={recentActivityByTicketId?.[t.id] ?? []}
                linkedFollowUp={linkedFollowUps?.get(t.id)}
              />
            ))}
          </ul>
        ) : tickets.length > 0 ? (
          <p className="text-muted-foreground text-sm italic">
            No active threads — see closed below for history.
          </p>
        ) : null}
        {closed.length > 0 ? (
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
            <ul className="flex flex-col gap-3 px-3 pb-3 pt-1">
              {closed.map((t) => (
                <ThreadCard
                  key={t.id}
                  projectSlug={projectSlug}
                  projectName={projectName}
                  ticket={t}
                  primary={t.id === primaryId}
                  followUps={followUpsByTicket.get(t.id) ?? []}
                  recentActivity={[]}
                  dim
                />
              ))}
            </ul>
          </details>
        ) : null}
        {unattributed.length > 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2">
            <p className="text-muted-foreground mb-1.5 text-[11px] font-medium uppercase tracking-wide">
              Unattributed follow-ups · {unattributed.length}
            </p>
            <p className="text-muted-foreground/80 mb-2 text-[11px] italic">
              These don&rsquo;t mention a Zendesk ticket id in the task
              text. Add <code className="bg-muted rounded px-1 py-0.5">
                #&lt;id&gt;
              </code>{" "}
              to the task to file it under a thread.
            </p>
            <ul className="flex flex-col divide-y">
              {unattributed.map((f) => (
                <FollowUpRow
                  key={f.follow_up_id}
                  projectSlug={projectSlug}
                  fu={f}
                />
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Inline follow-up status shown below each ticket row. When a linked follow-up
 * exists and is active, shows either a watching pill (no response yet) or an
 * amber banner prompting the user to resolve (response detected). When no
 * linked follow-up exists, shows a hover "Watch" trigger.
 */
function LinkedFollowUpInline({
  linkedFollowUp,
  projectSlug,
  projectName,
  ticket,
}: {
  linkedFollowUp?: import("@/app/projects/[slug]/page").LinkedFollowUpEntry;
  projectSlug: string;
  projectName: string;
  ticket: ZendeskTicketSummary;
}) {
  if (!linkedFollowUp) {
    return (
      <WatchForReplyDialog
        projectSlug={projectSlug}
        projectName={projectName}
        sourceType="zendesk"
        sourceRef={ticket.id}
        defaultTask={`Follow up on #${ticket.id}${ticket.subject ? ` — ${ticket.subject}` : ""}`}
      />
    );
  }

  // Active linked follow-up — show status.
  const { has_activity, follow_up_by, follow_up_id } = linkedFollowUp;

  if (has_activity) {
    return (
      <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <span className="flex-1">Response detected — resolve this follow-up?</span>
        <ResolveFollowUpButton
          projectSlug={projectSlug}
          followUpId={follow_up_id}
          label={linkedFollowUp.task}
          alwaysVisible
        />
        <SnoozeFollowUpButton
          projectSlug={projectSlug}
          followUpId={follow_up_id}
          label={linkedFollowUp.task}
          alwaysVisible
        />
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = follow_up_by
    ? Math.ceil((Date.parse(follow_up_by) - Date.parse(today)) / 86_400_000)
    : null;
  const dueText = follow_up_by
    ? daysLeft !== null && daysLeft < 0
      ? `due ${follow_up_by} · ${Math.abs(daysLeft)}d overdue`
      : `due ${follow_up_by} · ${daysLeft}d left`
    : "no due date";

  return (
    <p className="text-muted-foreground text-[11px]">
      Watching for reply · {dueText}
    </p>
  );
}

function ThreadCard({
  projectSlug,
  projectName,
  ticket,
  primary,
  followUps,
  recentActivity,
  dim = false,
  linkedFollowUp,
}: {
  projectSlug: string;
  projectName?: string;
  ticket: ZendeskTicketSummary;
  primary: boolean;
  followUps: FollowUp[];
  recentActivity: ActivityEvent[];
  dim?: boolean;
  linkedFollowUp?: import("@/app/projects/[slug]/page").LinkedFollowUpEntry;
}) {
  const activeFu = followUps.filter((f) => f.status !== "resolved");
  const resolvedFu = followUps.filter((f) => f.status === "resolved");
  // Most recent external (partner) comment, if any — drives the
  // "partner replied" stall hint on follow-ups whose `sent` predates it.
  const lastExternalActivity = recentActivity.find(
    (e) => e.actor?.is_external === true,
  );
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        dim ? "border-muted bg-muted/20" : "border-border",
      )}
    >
      <ZendeskRow
        ticket={ticket}
        primary={primary}
        dim={dim}
        projectSlug={projectSlug}
      />
      <LinkedFollowUpInline
        linkedFollowUp={linkedFollowUp}
        projectSlug={projectSlug}
        projectName={projectName ?? ""}
        ticket={ticket}
      />
      {followUps.length > 0 ? (
        <div className="border-t pt-2">
          <p className="text-muted-foreground mb-1 text-[11px] font-medium uppercase tracking-wide">
            Follow-ups · {activeFu.length} active
            {resolvedFu.length > 0 ? ` · ${resolvedFu.length} resolved` : ""}
          </p>
          <ul className="flex flex-col divide-y">
            {activeFu.map((f) => (
              <FollowUpRow
                key={f.follow_up_id}
                projectSlug={projectSlug}
                fu={f}
                highlight
                stallHint={detectStallHint(f, ticket, lastExternalActivity)}
              />
            ))}
            {resolvedFu.slice(0, 3).map((f) => (
              <FollowUpRow
                key={f.follow_up_id}
                projectSlug={projectSlug}
                fu={f}
                dim
              />
            ))}
            {resolvedFu.length > 3 ? (
              <li className="text-muted-foreground/70 py-1 text-[11px]">
                + {resolvedFu.length - 3} more resolved
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      {recentActivity.length > 0 ? (
        <details className="group/activity border-t">
          <summary
            className={cn(
              "flex cursor-pointer list-none items-center gap-2 pt-2",
              "text-muted-foreground text-[11px] font-medium uppercase tracking-wide",
              "hover:text-foreground",
            )}
          >
            <ChevronRight className="size-3 transition-transform group-open/activity:rotate-90" />
            Recent activity · {recentActivity.length}
          </summary>
          <ul className="mt-1.5 flex flex-col divide-y">
            {recentActivity.slice(0, 5).map((e) => (
              <ActivityRow key={e.id} event={e} />
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

interface StallHint {
  /** Why the row is suspected stale. */
  reason: string;
  /** Visual urgency — "thread closed" is harder evidence than "partner replied". */
  level: "strong" | "soft";
}

function FollowUpRow({
  projectSlug,
  fu,
  highlight = false,
  dim = false,
  stallHint,
}: {
  projectSlug: string;
  fu: FollowUp;
  highlight?: boolean;
  dim?: boolean;
  stallHint?: StallHint | null;
}) {
  const showHint = !!stallHint && fu.status !== "resolved";
  return (
    <li
      className={cn(
        "group flex items-start gap-2 py-1.5 first:pt-0 last:pb-0",
        dim && "text-muted-foreground",
      )}
    >
      {fu.status === "resolved" ? (
        <CheckCircle2 className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
      ) : (
        <Clock
          className={cn(
            "mt-0.5 size-3.5 shrink-0",
            showHint
              ? "text-emerald-600 dark:text-emerald-400"
              : highlight
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground",
          )}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p
          className={cn(
            "text-sm leading-snug",
            highlight && "text-foreground font-medium",
            dim && "line-through",
          )}
        >
          {fu.task}
        </p>
        <p className="text-muted-foreground text-[11px]">
          sent {fu.sent}
          {fu.follow_up_by ? ` · due ${fu.follow_up_by}` : ""}
          {fu.status_note ? ` · ${fu.status_note}` : ""}
        </p>
        {showHint ? (
          <span
            className={cn(
              "mt-0.5 inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
              stallHint!.level === "strong"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                : "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
            )}
            title="Suggested cleanup based on thread state"
          >
            <CheckCircle2 className="size-2.5" />
            {stallHint!.reason} — likely safe to resolve
          </span>
        ) : null}
      </div>
      {fu.status !== "resolved" ? (
        <div className="flex shrink-0 items-center gap-1">
          <ConvertFollowUpToTaskButton
            projectSlug={projectSlug}
            followUpId={fu.follow_up_id}
            label={fu.task}
          />
          <DraftFollowUpNudgeButton
            projectSlug={projectSlug}
            followUpId={fu.follow_up_id}
            label={fu.task}
          />
          <SnoozeFollowUpButton
            projectSlug={projectSlug}
            followUpId={fu.follow_up_id}
            label={fu.task}
            alwaysVisible={showHint}
          />
          <ResolveFollowUpButton
            projectSlug={projectSlug}
            followUpId={fu.follow_up_id}
            label={fu.task}
            alwaysVisible={showHint}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * Compute a stall hint for a follow-up based on its parent ticket's
 * state and the most recent external (partner) comment we know about.
 *
 * Returns the strongest signal available:
 *   - "thread closed" — ticket is solved/closed (overrides partner-replied)
 *   - "partner replied" — last external comment is newer than the
 *     follow-up's `sent` date (we owed the partner a reply, they
 *     beat us to it, follow-up probably reflects work that's done)
 */
function detectStallHint(
  fu: FollowUp,
  ticket: ZendeskTicketSummary,
  lastExternalActivity: ActivityEvent | undefined,
): StallHint | null {
  const status = ticket.status?.toLowerCase() ?? "";
  if (status === "solved" || status === "closed") {
    return { reason: "Thread closed", level: "strong" };
  }
  if (lastExternalActivity && fu.sent) {
    // Compare YYYY-MM-DD substrings — fu.sent is a date string, the
    // activity timestamp is full ISO. As long as the activity is on a
    // later date than `sent`, treat as a reply that came in after.
    const activityDate = lastExternalActivity.timestamp.slice(0, 10);
    if (activityDate > fu.sent) {
      const days = daysBetween(fu.sent, activityDate);
      return {
        reason: `Partner replied ${days === 0 ? "after" : `${days}d after`} you sent`,
        level: "soft",
      };
    }
  }
  return null;
}

function daysBetween(start: string, end: string): number {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  return (
    <li className="flex items-start gap-2 py-1.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-1.5 text-sm">
          {event.actor ? (
            <span
              className={cn(
                "shrink-0 text-sm font-medium",
                event.actor.is_external
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-foreground",
              )}
            >
              {event.actor.name}
            </span>
          ) : null}
          <span className="text-muted-foreground/80 text-[11px] tabular-nums">
            {formatRelative(event.timestamp)}
          </span>
        </div>
        {event.excerpt ? (
          <p className="text-muted-foreground text-xs leading-snug">
            {event.excerpt}
          </p>
        ) : null}
      </div>
    </li>
  );
}

const TICKET_ID_RE = /#(\d{5,})/;

function groupFollowUpsByTicket(followUps: FollowUp[]): {
  byTicket: Map<string, FollowUp[]>;
  unattributed: FollowUp[];
} {
  const byTicket = new Map<string, FollowUp[]>();
  const unattributed: FollowUp[] = [];
  for (const f of followUps) {
    const m = f.task.match(TICKET_ID_RE);
    if (m) {
      const id = m[1]!;
      const existing = byTicket.get(id) ?? [];
      existing.push(f);
      byTicket.set(id, existing);
    } else {
      unattributed.push(f);
    }
  }
  return { byTicket, unattributed };
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
  projectSlug,
}: {
  ticket: ZendeskTicketSummary;
  primary: boolean;
  dim?: boolean;
  /** Required when the row should expose a "Make primary" affordance. */
  projectSlug?: string;
}) {
  // Plain <div>: ZendeskRow now renders inside ThreadCard's <li>, so it
  // can't itself be an <li> (would produce invalid <li><li/></li> nesting).
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3",
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
      <div className="flex shrink-0 items-center gap-1.5">
        {projectSlug && !dim ? (
          <DraftZendeskReplyButton
            projectSlug={projectSlug}
            ticketId={ticket.id}
            ticketSubject={ticket.subject}
          />
        ) : null}
        {projectSlug && !primary ? (
          <MakePrimaryButton
            projectSlug={projectSlug}
            ticketId={ticket.id}
            ticketLabel={ticket.subject ?? `#${ticket.id}`}
          />
        ) : null}
        <a
          href={ticket.url}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
        >
          Open
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
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
