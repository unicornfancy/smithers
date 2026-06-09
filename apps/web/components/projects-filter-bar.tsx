"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";

import type { ProjectStatus } from "@smithers/vault";

import { cn } from "@/lib/utils";

export type ProjectsSortKey = "name" | "status" | "activity";

interface Props {
  currentStatus: string;
  showArchived: boolean;
  currentSort: ProjectsSortKey;
  /** Counts per status across the unfiltered project list. */
  counts: Partial<Record<ProjectStatus, number>>;
}

const STATUS_ORDER: ProjectStatus[] = [
  "hot",
  "active",
  "at-risk",
  "secondary",
  "cold",
  "research",
  "planning",
  "launched",
  "archived",
];

const SORT_LABEL: Record<ProjectsSortKey, string> = {
  name: "Name",
  status: "Status",
  activity: "Activity",
};

export function ProjectsFilterBar({
  currentStatus,
  showArchived,
  currentSort,
  counts,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Only offer statuses that actually have projects, in the rank order above.
  const availableStatuses = STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0);

  function pushWith(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    // Persist sort choice in a cookie so /projects opens on the last
    // selection on the next visit. URL still wins when present
    // (shareable links carry the explicit sort).
    if ("sort" in updates && typeof document !== "undefined") {
      const next = updates.sort;
      const year = 60 * 60 * 24 * 365;
      if (next) {
        document.cookie = `smithers_projects_sort=${next}; Max-Age=${year}; Path=/; SameSite=Lax`;
      } else {
        // null/empty → reset to default; clear the cookie so the
        // server-side fallback returns to "name."
        document.cookie = `smithers_projects_sort=; Max-Age=0; Path=/; SameSite=Lax`;
      }
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/projects?${qs}` : "/projects");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">
          Status
        </span>
        <select
          value={currentStatus}
          onChange={(e) => pushWith({ status: e.target.value === "all" ? null : e.target.value })}
          disabled={pending}
          className="rounded-md border bg-background px-2 py-1 text-sm"
        >
          <option value="all">All</option>
          {availableStatuses.map((s) => (
            <option key={s} value={s}>
              {s} ({counts[s]})
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">
          Sort
        </span>
        <select
          value={currentSort}
          onChange={(e) =>
            pushWith({ sort: e.target.value === "name" ? null : e.target.value })
          }
          disabled={pending}
          className="rounded-md border bg-background px-2 py-1 text-sm"
        >
          {(Object.keys(SORT_LABEL) as ProjectsSortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABEL[key]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) =>
            pushWith({ archived: e.target.checked ? "1" : null })
          }
          disabled={pending}
          className="accent-foreground"
        />
        Show archived
        {(counts.archived ?? 0) > 0 ? (
          <span className="text-muted-foreground tabular-nums">
            ({counts.archived})
          </span>
        ) : null}
      </label>

      {pending ? (
        <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
      ) : null}

      {currentStatus !== "all" || showArchived || currentSort !== "name" ? (
        <button
          type="button"
          onClick={() =>
            pushWith({ status: null, archived: null, sort: null })
          }
          disabled={pending}
          className={cn(
            "text-muted-foreground hover:text-foreground ml-auto text-xs underline-offset-2 hover:underline",
            pending && "opacity-50",
          )}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
