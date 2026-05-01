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
}

/**
 * Backfill metadata for attached Zendesk tickets that don't yet have
 * a persisted subject. One click runs a fan-out search and writes
 * any matches into frontmatter so subsequent renders are instant.
 */
export function RefreshZendeskMetadataButton({ projectSlug, hints }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const r = await refreshZendeskMetadataAction(projectSlug, hints);
        if (r.updated > 0) {
          toast.success(
            `Refreshed ${r.updated} of ${r.total} ticket${r.total === 1 ? "" : "s"}`,
          );
        } else {
          toast.info(
            r.total === 0
              ? "No tickets attached"
              : "No new metadata found — Zendesk search didn't surface those tickets",
          );
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
