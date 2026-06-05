"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ExternalLink, Loader2, Mail, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  attachZendeskTicketAction,
  findSuggestedZendeskTicketsAction,
  type SuggestedZendeskTicket,
} from "@/app/projects/[slug]/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Inlined to avoid pulling the @smithers/mcp-client barrel (and its
// node-only MCP SDK transitive deps) into the client bundle. The URL
// shape lives in packages/mcp-client/src/context-a8c/zendesk-refs.ts;
// keep these two in sync if the agent UI domain ever moves.
function zendeskTicketUrl(ticketId: string): string {
  return `https://automattic.zendesk.com/agent/tickets/${ticketId}`;
}

interface Props {
  projectSlug: string;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; tickets: SuggestedZendeskTicket[] }
  | { kind: "no-search-terms" }
  | { kind: "error"; message: string };

/**
 * Lazy-loaded "Suggested tickets" disclosure. Searches Zendesk for
 * tickets matching the partner's contact emails (from HM partner-
 * knowledge) + per-project search terms, filters to un-attached, and
 * shows them with one-click Attach buttons.
 *
 * Network-cheap because it doesn't fire until the user opens the
 * disclosure — typical workbench loads stay fast.
 */
export function SuggestedZendeskTickets({ projectSlug }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<State>({ kind: "idle" });
  const [attaching, setAttaching] = React.useState<string | null>(null);

  async function load() {
    setState({ kind: "loading" });
    try {
      const res = await findSuggestedZendeskTicketsAction(projectSlug);
      if (res.ok) {
        setState({ kind: "loaded", tickets: res.data });
      } else if (res.reason === "no-search-terms") {
        setState({ kind: "no-search-terms" });
      } else {
        setState({ kind: "error", message: res.message ?? "Search failed" });
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Search failed",
      });
    }
  }

  function handleToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    const next = e.currentTarget.open;
    setOpen(next);
    if (next && state.kind === "idle") {
      void load();
    }
  }

  async function handleAttach(ticket: SuggestedZendeskTicket) {
    setAttaching(ticket.id);
    try {
      await attachZendeskTicketAction(projectSlug, {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        updated_at: ticket.updated_at,
      });
      toast.success(`Attached #${ticket.id}`);
      // Optimistically drop the just-attached row instead of re-running
      // the full search. A workbench refresh will pick up the new
      // attached state on the next render.
      if (state.kind === "loaded") {
        setState({
          kind: "loaded",
          tickets: state.tickets.filter((t) => t.id !== ticket.id),
        });
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Attach failed");
    } finally {
      setAttaching(null);
    }
  }

  const count =
    state.kind === "loaded" ? state.tickets.length : null;

  return (
    <details
      open={open}
      onToggle={handleToggle}
      className="group/suggested rounded-md border border-dashed bg-muted/20 px-2.5 py-1.5"
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2",
          "text-muted-foreground text-[11px] font-medium uppercase tracking-wide",
          "hover:text-foreground",
        )}
      >
        <ChevronRight className="size-3 transition-transform group-open/suggested:rotate-90" />
        <Mail className="size-3" />
        Suggested tickets
        {count !== null ? (
          <span className="text-muted-foreground/80 normal-case tracking-normal">
            · {count === 0 ? "none new" : `${count} unattached`}
          </span>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void load();
          }}
          className="text-muted-foreground hover:text-foreground ml-auto text-[10px] normal-case tracking-normal underline-offset-2 hover:underline disabled:opacity-50"
          disabled={state.kind === "loading"}
          title="Re-run search"
        >
          {state.kind === "loading" ? "searching…" : "refresh"}
        </button>
      </summary>

      <div className="mt-2 space-y-2 text-sm">
        {state.kind === "idle" ? (
          <p className="text-muted-foreground text-xs italic">
            Click to scan Zendesk for unattached tickets from this partner&apos;s
            contacts.
          </p>
        ) : null}
        {state.kind === "loading" ? (
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3 animate-spin" />
            Scanning Zendesk…
          </p>
        ) : null}
        {state.kind === "no-search-terms" ? (
          <p className="text-muted-foreground text-xs">
            No partner contact emails or per-project search terms configured.
            Add contacts to the partner&apos;s{" "}
            <code className="bg-muted rounded px-1 py-0.5 text-[10px]">
              partner-knowledge.md
            </code>{" "}
            or per-project search terms via the settings cog above.
          </p>
        ) : null}
        {state.kind === "error" ? (
          <p className="text-destructive text-xs">{state.message}</p>
        ) : null}
        {state.kind === "loaded" && state.tickets.length === 0 ? (
          <p className="text-muted-foreground text-xs italic">
            No new tickets matching this partner&apos;s contacts.
          </p>
        ) : null}
        {state.kind === "loaded" && state.tickets.length > 0 ? (
          <ul className="flex flex-col divide-y">
            {state.tickets.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-2 py-1.5 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <a
                    href={zendeskTicketUrl(t.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground inline-flex items-center gap-1 text-[13px] leading-snug hover:underline"
                  >
                    <span className="text-muted-foreground font-mono text-[10px]">
                      #{t.id}
                    </span>
                    <span className="truncate">
                      {t.subject ?? "(no subject)"}
                    </span>
                    <ExternalLink className="size-2.5 opacity-60" />
                  </a>
                  <div className="text-muted-foreground flex items-center gap-2 text-[10px]">
                    {t.status ? <span>{t.status}</span> : null}
                    {t.updated_at ? (
                      <span>· updated {t.updated_at.slice(0, 10)}</span>
                    ) : null}
                    <span className="truncate">· matched {t.matched_term}</span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                  onClick={() => void handleAttach(t)}
                  disabled={attaching === t.id}
                >
                  {attaching === t.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Plus className="size-3" />
                  )}
                  Attach
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
