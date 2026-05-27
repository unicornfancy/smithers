"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

export interface SettingsTab {
  id: string;
  label: string;
}

interface Props {
  tabs: SettingsTab[];
  /** Tab to show when none is selected via URL. */
  defaultTabId?: string;
  /**
   * Section bodies, one per tab, in the same order as `tabs`.
   * The component renders only the body whose tab is active.
   * (All bodies are still on the server-rendered tree; passing them
   * as siblings here keeps the page a single render pass.)
   */
  children: React.ReactNode;
}

/**
 * Top tab strip for /settings. Underline-style tabs; clicking a tab
 * swaps the visible section. State persists via `?tab=<id>` search
 * param so URLs are shareable and browser back/forward works.
 *
 * Why a search param rather than the URL hash: hashes don't survive
 * the Next.js server-side render path, so deep links from the address
 * bar would flicker through the default tab. Search params survive.
 */
export function SettingsTabs({ tabs, defaultTabId, children }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fallback = defaultTabId ?? tabs[0]?.id ?? "";
  const requested = searchParams.get("tab") ?? fallback;
  // Guard against an out-of-range or stale tab id in the URL.
  const activeId = tabs.some((t) => t.id === requested) ? requested : fallback;

  const childrenArray = React.Children.toArray(children);
  const activeIndex = tabs.findIndex((t) => t.id === activeId);
  const safeIndex = activeIndex >= 0 ? activeIndex : 0;

  function switchTab(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (id === fallback) {
      params.delete("tab");
    } else {
      params.set("tab", id);
    }
    const qs = params.toString();
    router.replace(qs ? `/settings?${qs}` : "/settings", { scroll: false });
  }

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Settings sections"
        className="border-border flex flex-wrap items-end gap-1 border-b"
      >
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => switchTab(tab.id)}
              className={cn(
                "relative -mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                active
                  ? "border-foreground text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">{childrenArray[safeIndex]}</div>
    </div>
  );
}
