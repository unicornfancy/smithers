"use client";

import * as React from "react";

/**
 * The project workbench's render mode — either the historical
 * single-long-scroll layout or the 4-tab layout introduced 2026-06-04.
 *
 * Persisted to localStorage so the choice survives reloads + applies
 * across every project workbench instance. Default is "single-page"
 * so existing users see no change unless they opt in via /settings.
 *
 * Per-tab section reorder/hide is still owned by `useLayoutPrefs`;
 * this hook only picks the outer container.
 */
export type WorkbenchLayout = "single-page" | "tabs";

const STORAGE_KEY = "smithers:workbench-layout";
const DEFAULT_LAYOUT: WorkbenchLayout = "single-page";

const subscribers = new Set<(next: WorkbenchLayout) => void>();

function readStored(): WorkbenchLayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "tabs" || raw === "single-page") return raw;
    return DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function writeStored(next: WorkbenchLayout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* quota / private-browsing — non-fatal */
  }
}

export function useWorkbenchLayout(): [
  WorkbenchLayout,
  (next: WorkbenchLayout) => void,
] {
  // SSR + initial-client renders return the default so server-rendered
  // HTML never mismatches client. Subscribers below sync to the real
  // stored value after mount.
  const [layout, setLayout] = React.useState<WorkbenchLayout>(DEFAULT_LAYOUT);

  React.useEffect(() => {
    setLayout(readStored());
    const onChange = (next: WorkbenchLayout) => setLayout(next);
    subscribers.add(onChange);
    return () => {
      subscribers.delete(onChange);
    };
  }, []);

  // Cross-tab sync — localStorage's "storage" event fires in OTHER
  // windows when this one writes, so a Settings tab + a workbench tab
  // stay in agreement without a page refresh.
  React.useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      setLayout(readStored());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const set = React.useCallback((next: WorkbenchLayout) => {
    writeStored(next);
    setLayout(next);
    // Notify same-tab subscribers (the "storage" event only fires
    // across tabs/windows, never in the originating one).
    for (const fn of subscribers) fn(next);
  }, []);

  return [layout, set];
}
