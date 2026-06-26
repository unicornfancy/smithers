"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { refreshZendeskMetadataAction } from "@/app/projects/[slug]/actions";
import { Button } from "@/components/ui/button";

interface Props {
  projectSlug: string;
  /**
   * Search hints we'll fan out to Zendesk to backfill subjects/statuses.
   * Usually [partner display name, deslug'd partner slug, project name]
   * — first three non-empty hints get queried and the union of results
   * is matched against attached tickets.
   */
  hints: string[];
  /**
   * Partner contact emails (from HM partner-knowledge contacts[]). The
   * action runs `requester:<email>` searches for each, which catches
   * tickets whose subjects don't contain the partner name.
   */
  contactEmails?: string[];
}

/**
 * Backfill metadata for attached Zendesk tickets that don't yet have
 * a persisted subject. One click runs a fan-out search and writes
 * any matches into frontmatter so subsequent renders are instant.
 */
export function RefreshZendeskMetadataButton({
  projectSlug,
  hints,
  contactEmails,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const r = await refreshZendeskMetadataAction(
          projectSlug,
          hints,
          contactEmails ?? [],
        );
        if (r.updated > 0) {
          toast.success(
            `Refreshed ${r.updated} of ${r.total} ticket${r.total === 1 ? "" : "s"}`,
          );
        } else if (r.total === 0) {
          toast.info("No tickets attached");
        } else {
          // Surface the diagnostics so we can tell apart "search came
          // back fresh, statuses matched what we had" from "search
          // silently failed for every hint" and "search succeeded but
          // never returned the attached tickets".
          const d = r.diagnostics;
          const anyFailed = d.hints.some((h) => h.failed);
          const noHits = d.hints.every((h) => h.total === 0);
          const totalMatched = d.hints.reduce((acc, h) => acc + h.matched, 0);
          let detail: string;
          if (anyFailed) {
            const failedHints = d.hints
              .filter((h) => h.failed)
              .map((h) => h.hint)
              .join(", ");
            detail = `Search failed for: ${failedHints}. Check Zendesk OAuth or restart pnpm dev.`;
          } else if (noHits) {
            detail = `All ${d.hints.length} hint searches returned zero results — Zendesk auth may have expired.`;
          } else if (d.unseen_ticket_ids.length > 0) {
            detail = `Searched ${d.hints.length} hint${d.hints.length === 1 ? "" : "s"}, saw ${totalMatched} attached ticket${totalMatched === 1 ? "" : "s"}; ${d.unseen_ticket_ids.length} never appeared in results: ${d.unseen_ticket_ids.slice(0, 4).join(", ")}${d.unseen_ticket_ids.length > 4 ? "…" : ""}`;
          } else {
            detail = `Searched ${d.hints.length} hint${d.hints.length === 1 ? "" : "s"}, saw all ${totalMatched} attached ticket${totalMatched === 1 ? "" : "s"} — Zendesk reports same status as frontmatter.`;
          }
          toast.info(detail, { duration: 10_000 });
        }
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't refresh metadata",
        );
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={pending}
      title="Backfill subject + status for attached tickets"
      className="h-7 gap-1.5 text-xs"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <RefreshCw className="size-3.5" />
      )}
      Refresh
    </Button>
  );
}
