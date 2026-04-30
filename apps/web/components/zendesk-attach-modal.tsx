"use client";

import * as React from "react";
import { AlertTriangle, LifeBuoy, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import type { ZendeskTicketSummary } from "@smithers/mcp-client";

import {
  attachZendeskTicketAction,
  searchZendeskTicketsAction,
} from "@/app/projects/[slug]/actions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Props {
  projectSlug: string;
  /** Existing tickets so the modal can show "already attached" state. */
  existingTicketIds: string[];
  /** Optional: prefilled query (e.g. partner name from the workbench header). */
  defaultQuery?: string;
}

/**
 * Search-and-attach modal for adding Zendesk threads to a project. Free-text
 * query → list of matching tickets → click "Attach" to write the ref into
 * frontmatter. Already-attached tickets are shown disabled with a small
 * indicator so it's obvious which threads are wired up.
 */
export function ZendeskAttachModal({
  projectSlug,
  existingTicketIds,
  defaultQuery,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState(defaultQuery ?? "");
  const [searching, startSearchTransition] = React.useTransition();
  const [results, setResults] = React.useState<ZendeskTicketSummary[]>([]);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [hasSearched, setHasSearched] = React.useState(false);

  const existingSet = React.useMemo(
    () => new Set(existingTicketIds),
    [existingTicketIds],
  );

  // Track which ids we've just attached this session so the row reflects
  // it without re-fetching the project. The server has already written
  // and revalidated the workbench path; this is just for the modal UI.
  const [justAttached, setJustAttached] = React.useState<Set<string>>(
    () => new Set(),
  );

  function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearchError(null);
      setHasSearched(false);
      return;
    }
    setHasSearched(true);
    startSearchTransition(async () => {
      try {
        const r = await searchZendeskTicketsAction(trimmed);
        if (r.ok) {
          setResults(r.tickets);
          setSearchError(null);
        } else {
          setResults([]);
          setSearchError(r.error);
        }
      } catch (err) {
        setResults([]);
        setSearchError(
          err instanceof Error ? err.message : "Search failed",
        );
      }
    });
  }

  function handleAttach(ticket: ZendeskTicketSummary) {
    setJustAttached((prev) => new Set(prev).add(ticket.id));
    void attachZendeskTicketAction(projectSlug, ticket.id)
      .then((r) => {
        if (r.added) {
          toast.success(
            `Attached ticket ${ticket.id}${ticket.subject ? ` — ${truncate(ticket.subject, 40)}` : ""}`,
          );
        } else {
          toast.info(`Ticket ${ticket.id} was already attached`);
        }
      })
      .catch((err: unknown) => {
        // Roll back the optimistic attached-marker so the user can retry.
        setJustAttached((prev) => {
          const next = new Set(prev);
          next.delete(ticket.id);
          return next;
        });
        toast.error(
          err instanceof Error ? err.message : "Couldn't attach ticket",
        );
      });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <LifeBuoy className="size-3.5" />
          Attach Zendesk thread
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Attach a Zendesk thread</DialogTitle>
          <DialogDescription>
            Search Automattic Zendesk by subject, requester, or tag. Click
            Attach to add the ticket to this project&rsquo;s frontmatter.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder="e.g. partner name, ticket subject, tag…"
              className={cn(
                "border-input bg-background focus-visible:ring-ring",
                "h-9 w-full rounded-md border pl-8 pr-3 text-sm",
                "focus-visible:outline-none focus-visible:ring-1",
              )}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={!query.trim() || searching}
            className="h-9"
          >
            {searching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              "Search"
            )}
          </Button>
        </form>

        <div className="max-h-[50vh] overflow-y-auto">
          {searchError ? (
            <DegradedNotice message={searchError} />
          ) : !hasSearched ? (
            <p className="text-muted-foreground py-6 text-center text-sm italic">
              Type a query above and press Enter.
            </p>
          ) : results.length === 0 && !searching ? (
            <p className="text-muted-foreground py-6 text-center text-sm italic">
              No tickets matched. Try a different keyword or use Zendesk
              syntax (e.g. <code className="bg-muted rounded px-1 py-0.5 text-[11px]">organization:foo</code>).
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {results.map((t) => {
                const alreadyAttached =
                  existingSet.has(t.id) || justAttached.has(t.id);
                return (
                  <li
                    key={t.id}
                    className="flex items-start gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <LifeBuoy className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p className="truncate text-sm leading-snug">
                        <span className="text-muted-foreground tabular-nums">
                          #{t.id}
                        </span>{" "}
                        {t.subject ?? <em className="opacity-70">(no subject)</em>}
                      </p>
                      <p className="text-muted-foreground text-[11px]">
                        {t.status ? <StatusBadge status={t.status} /> : null}
                        {t.updated_at ? (
                          <span className="ml-1.5">
                            updated {formatRelative(t.updated_at)}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={alreadyAttached ? "ghost" : "outline"}
                      disabled={alreadyAttached}
                      onClick={() => handleAttach(t)}
                      className="h-7 shrink-0 gap-1 px-2 text-xs"
                    >
                      {alreadyAttached ? (
                        "Attached"
                      ) : (
                        <>
                          <Plus className="size-3" />
                          Attach
                        </>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tint =
    status === "open"
      ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
      : status === "pending"
        ? "border-amber-500/40 text-amber-700 dark:text-amber-400"
        : "border-muted-foreground/30 text-muted-foreground";
  return (
    <Badge
      variant="outline"
      className={cn("h-4 px-1 text-[9px] font-normal uppercase", tint)}
    >
      {status}
    </Badge>
  );
}

function DegradedNotice({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50 p-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div>
        <p className="font-medium">Zendesk search failed</p>
        <p className="opacity-80">{message}</p>
      </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  const seconds = Math.floor((Date.now() - d.valueOf()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
