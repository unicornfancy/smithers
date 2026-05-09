"use client";

import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  RotateCcw,
  Settings2,
} from "lucide-react";
import * as React from "react";

import {
  useLayoutPrefs,
  type LayoutScope,
} from "@/lib/use-layout-prefs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface SectionDef {
  /** Stable id used in localStorage for ordering + visibility prefs. */
  id: string;
  /** Friendly title rendered in edit-mode toolbar + hidden-section stub. */
  title: string;
  /** When true, this section's body is hidden by default (user can flip). */
  defaultHidden?: boolean;
  /** Section node — usually a `<Card>...</Card>` rendered server-side. */
  node: React.ReactNode;
}

interface Props {
  scope: LayoutScope;
  sections: SectionDef[];
}

/**
 * Client wrapper that orders + shows/hides RSC-rendered sections per
 * the user's saved layout prefs. Edit mode exposes per-section move-up
 * / move-down / show-hide controls; outside edit mode, sections render
 * cleanly with no extra chrome.
 *
 * Hidden sections render nothing in normal view; in edit mode they
 * collapse to a small stub with a "Show" toggle so the user can
 * recover them.
 */
export function SectionList({ scope, sections }: Props) {
  const knownIds = React.useMemo(() => sections.map((s) => s.id), [sections]);
  const prefs = useLayoutPrefs(scope, knownIds);
  const sectionById = React.useMemo(() => {
    const map = new Map<string, SectionDef>();
    for (const s of sections) map.set(s.id, s);
    return map;
  }, [sections]);

  // Combine the effective order with any defaultHidden overrides for
  // sections the user hasn't explicitly toggled. The user's hidden set
  // always wins — so once they show a default-hidden section, it
  // stays shown.
  const isHidden = (s: SectionDef): boolean => {
    if (prefs.hidden.has(s.id)) return true;
    // Default-hidden only applies when the user hasn't explicitly
    // shown it. We track "explicit show" by absence from hidden +
    // any presence in `order` (proxy for "user has touched layout").
    if (s.defaultHidden && !prefs.isDirty) return true;
    return false;
  };

  const orderedSections = prefs.order
    .map((id) => sectionById.get(id))
    .filter((s): s is SectionDef => s !== undefined);

  return (
    <>
      <LayoutEditToolbar prefs={prefs} />
      {orderedSections.map((s, i) => {
        const hidden = isHidden(s);
        if (hidden && !prefs.isEditing) return null;
        return (
          <SectionWrapper
            key={s.id}
            section={s}
            hidden={hidden}
            isEditing={prefs.isEditing}
            isFirst={i === 0}
            isLast={i === orderedSections.length - 1}
            onMoveUp={() => prefs.moveUp(s.id)}
            onMoveDown={() => prefs.moveDown(s.id)}
            onToggleHidden={() => prefs.toggleHidden(s.id)}
          />
        );
      })}
    </>
  );
}

function LayoutEditToolbar({ prefs }: { prefs: ReturnType<typeof useLayoutPrefs> }) {
  return (
    <div className="flex items-center justify-end gap-2">
      {prefs.isEditing && prefs.isDirty ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
          onClick={prefs.reset}
          title="Restore default order and unhide all sections"
        >
          <RotateCcw className="size-3" />
          Reset layout
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-7 gap-1.5 px-2 text-xs",
          prefs.isEditing
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
        onClick={() => prefs.setEditing(!prefs.isEditing)}
        title={prefs.isEditing ? "Exit edit mode" : "Reorder + show/hide sections"}
      >
        <Settings2 className="size-3" />
        {prefs.isEditing ? "Done" : "Edit layout"}
      </Button>
    </div>
  );
}

function SectionWrapper({
  section,
  hidden,
  isEditing,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onToggleHidden,
}: {
  section: SectionDef;
  hidden: boolean;
  isEditing: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleHidden: () => void;
}) {
  if (!isEditing) {
    // Out of edit mode + visible — render the section as-is, no chrome.
    return <>{section.node}</>;
  }

  // Edit mode — every section gets a thin toolbar above. Hidden sections
  // collapse to just the toolbar so the user can flip them back on.
  return (
    <div className="space-y-2">
      <div className="border-input/60 bg-muted/30 flex items-center justify-between gap-2 rounded-md border border-dashed px-2 py-1">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-6 w-6 p-0"
            onClick={onMoveUp}
            disabled={isFirst}
            title="Move up"
            aria-label={`Move ${section.title} up`}
          >
            <ChevronUp className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-6 w-6 p-0"
            onClick={onMoveDown}
            disabled={isLast}
            title="Move down"
            aria-label={`Move ${section.title} down`}
          >
            <ChevronDown className="size-3" />
          </Button>
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            {section.title}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-6 gap-1 px-1.5 text-[11px]"
          onClick={onToggleHidden}
          title={hidden ? "Show this section" : "Hide this section"}
        >
          {hidden ? (
            <>
              <Eye className="size-3" />
              Show
            </>
          ) : (
            <>
              <EyeOff className="size-3" />
              Hide
            </>
          )}
        </Button>
      </div>
      {hidden ? null : section.node}
    </div>
  );
}
