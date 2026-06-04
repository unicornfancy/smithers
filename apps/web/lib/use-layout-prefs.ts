"use client";

import * as React from "react";

/**
 * Per-scope ("today" | "project") layout customization stored in
 * localStorage. The hook owns three pieces of state:
 *
 *   order: string[]           — user-defined section ordering (subset of known ids)
 *   hidden: Set<string>       — section ids the user has hidden
 *   isEditing: boolean        — edit-layout toggle in the page header
 *
 * Sections not present in `order` fall back to the page's default
 * order at the end (so adding new sections after the user has reordered
 * doesn't lose them — they appear at the bottom). Same for `hidden` —
 * only sections explicitly hidden are removed from view.
 *
 * Stored as separate localStorage keys per scope so /today and the
 * project workbench can have independent layouts when both ship.
 *
 * v1: localStorage only (per-browser, no sync). Promote to disk under
 * paths.data when cross-machine sync becomes a real ask.
 */
export type LayoutScope =
  | "today"
  | "project"
  | "project-tab-now"
  | "project-tab-comms"
  | "project-tab-knowledge"
  | "project-tab-drafts";

export interface LayoutPrefs {
  /** User-customized section order; sections not in here render after, in their default order. */
  order: string[];
  /** Section ids the user has hidden. */
  hidden: Set<string>;
  /** True when the page is in "edit layout" mode (drag handles + show/hide buttons visible). */
  isEditing: boolean;
  /** True when the user has any non-default state (order or hidden) that Reset would clear. */
  isDirty: boolean;
  setEditing: (next: boolean) => void;
  moveUp: (id: string) => void;
  moveDown: (id: string) => void;
  toggleHidden: (id: string) => void;
  reset: () => void;
}

interface StoredState {
  order: string[];
  hidden: string[];
}

const EMPTY: StoredState = { order: [], hidden: [] };

function storageKey(scope: LayoutScope): string {
  return `smithers:layout:${scope}`;
}

function readState(scope: LayoutScope): StoredState {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
    };
  } catch {
    return EMPTY;
  }
}

function writeState(scope: LayoutScope, state: StoredState): void {
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(state));
  } catch {
    /* ignore — storage quota / private mode */
  }
}

export function useLayoutPrefs(
  scope: LayoutScope,
  /** All known section ids in their default render order. Used to fill in unordered tail. */
  knownIds: string[],
): LayoutPrefs {
  const [order, setOrder] = React.useState<string[]>([]);
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [isEditing, setIsEditing] = React.useState(false);

  // Hydrate from localStorage on mount. Avoids SSR/client divergence by
  // starting with empty state (which renders the page in default order)
  // and letting the saved prefs apply post-hydration.
  React.useEffect(() => {
    const stored = readState(scope);
    setOrder(stored.order);
    setHidden(new Set(stored.hidden));
  }, [scope]);

  const persist = React.useCallback(
    (nextOrder: string[], nextHidden: Set<string>) => {
      writeState(scope, {
        order: nextOrder,
        hidden: Array.from(nextHidden),
      });
    },
    [scope],
  );

  // Materialize the effective order: user's order first, then any
  // known ids the user hasn't touched, in their default order. Keeps
  // newly-added sections discoverable.
  const effectiveOrder = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of order) {
      if (knownIds.includes(id) && !seen.has(id)) {
        out.push(id);
        seen.add(id);
      }
    }
    for (const id of knownIds) {
      if (!seen.has(id)) {
        out.push(id);
        seen.add(id);
      }
    }
    return out;
  }, [order, knownIds]);

  const moveUp = React.useCallback(
    (id: string) => {
      const idx = effectiveOrder.indexOf(id);
      if (idx <= 0) return;
      const next = [...effectiveOrder];
      [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
      setOrder(next);
      persist(next, hidden);
    },
    [effectiveOrder, hidden, persist],
  );

  const moveDown = React.useCallback(
    (id: string) => {
      const idx = effectiveOrder.indexOf(id);
      if (idx === -1 || idx >= effectiveOrder.length - 1) return;
      const next = [...effectiveOrder];
      [next[idx], next[idx + 1]] = [next[idx + 1]!, next[idx]!];
      setOrder(next);
      persist(next, hidden);
    },
    [effectiveOrder, hidden, persist],
  );

  const toggleHidden = React.useCallback(
    (id: string) => {
      const next = new Set(hidden);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setHidden(next);
      persist(order, next);
    },
    [order, hidden, persist],
  );

  const reset = React.useCallback(() => {
    setOrder([]);
    setHidden(new Set());
    persist([], new Set());
  }, [persist]);

  const isDirty = order.length > 0 || hidden.size > 0;

  return {
    order: effectiveOrder,
    hidden,
    isEditing,
    isDirty,
    setEditing: setIsEditing,
    moveUp,
    moveDown,
    toggleHidden,
    reset,
  };
}
