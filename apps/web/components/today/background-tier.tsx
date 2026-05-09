"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

interface Props {
  /** Heading shown next to the toggle. */
  label: string;
  /** Default collapse state. /today's BACKGROUND tier defaults collapsed. */
  defaultOpen?: boolean;
  /** Sub-cards / sections that live in this tier. */
  children: React.ReactNode;
}

/**
 * Collapsible wrapper for the /today BACKGROUND tier — items that are
 * useful but rarely the first thing the user wants to see. Defaults
 * collapsed; the user can pop it open and the choice persists in
 * localStorage so the next page load remembers.
 *
 * Phase: T2 (initial 3-tier layout). Stage 1 of flex (T3) will replace
 * this hardcoded localStorage key with the per-section ordering /
 * collapse store.
 */
export function BackgroundTier({ label, defaultOpen = false, children }: Props) {
  const storageKey = `smithers:today:bg:${slugifyLabel(label)}`;
  const [open, setOpen] = React.useState<boolean | null>(null);

  // Read persisted state on mount (lazy — keep SSR tree stable, hydrate
  // the toggle on the client).
  React.useEffect(() => {
    try {
      const v = window.localStorage.getItem(storageKey);
      if (v === "1") setOpen(true);
      else if (v === "0") setOpen(false);
      else setOpen(defaultOpen);
    } catch {
      setOpen(defaultOpen);
    }
  }, [storageKey, defaultOpen]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  // Pre-hydration: render closed shell. Avoids a flash of expanded
  // content before localStorage settles.
  const isOpen = open === null ? defaultOpen : open;

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide transition-colors",
        )}
      >
        {isOpen ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        {label}
      </button>
      {isOpen ? <div className="space-y-3">{children}</div> : null}
    </section>
  );
}

function slugifyLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
