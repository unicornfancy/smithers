"use client";

import * as React from "react";
import {
  CheckSquare,
  FileText,
  MessageSquare,
  Sparkles,
} from "lucide-react";

import { SectionList, type SectionDef } from "@/components/section-list";
import type { LayoutScope } from "@/lib/use-layout-prefs";
import { cn } from "@/lib/utils";

export type WorkbenchTabId = "now" | "comms" | "knowledge" | "drafts";

interface TabSpec {
  id: WorkbenchTabId;
  label: string;
  scope: LayoutScope;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabSpec[] = [
  { id: "now", label: "Now", scope: "project-tab-now", icon: CheckSquare },
  { id: "comms", label: "Comms", scope: "project-tab-comms", icon: MessageSquare },
  {
    id: "knowledge",
    label: "Knowledge",
    scope: "project-tab-knowledge",
    icon: FileText,
  },
  { id: "drafts", label: "Drafts", scope: "project-tab-drafts", icon: Sparkles },
];

/**
 * Per-tab section order. Each entry lists the section IDs that belong
 * to that tab in the order they should appear. Sections not in any
 * tab's list fall through to "now" so a newly-added section is always
 * reachable until it's explicitly assigned.
 *
 * Adjust this — not the page's section-push order — when you want a
 * card to move between tabs. The single-page layout (SectionList with
 * scope="project") reads the page's natural order and is unaffected.
 */
const TAB_ORDER: Record<WorkbenchTabId, string[]> = {
  now: [
    "needs-decision",
    "for-you-today",
    "milestones",
    "project-status",
    "open-items",
    "live-activity",
  ],
  comms: ["zendesk-threads", "recent-calls", "agenda"],
  knowledge: [
    "project-brief",
    "project-log",
    "partner-info",
    "personal-notes",
    "partner-profile",
    "project-launch-post",
    "project-handoff",
  ],
  drafts: ["drafts-for-project"],
};

const SECTION_TAB_MAP: Record<string, WorkbenchTabId> = (() => {
  const map: Record<string, WorkbenchTabId> = {};
  for (const tab of Object.keys(TAB_ORDER) as WorkbenchTabId[]) {
    for (const id of TAB_ORDER[tab]) map[id] = tab;
  }
  return map;
})();

function activeTabKey(projectSlug: string): string {
  return `smithers:workbench-tab:${projectSlug}`;
}

function readActiveTab(projectSlug: string): WorkbenchTabId {
  if (typeof window === "undefined") return "now";
  try {
    const raw = window.localStorage.getItem(activeTabKey(projectSlug));
    if (raw === "now" || raw === "comms" || raw === "knowledge" || raw === "drafts")
      return raw;
  } catch {
    /* swallow */
  }
  return "now";
}

function writeActiveTab(projectSlug: string, tab: WorkbenchTabId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(activeTabKey(projectSlug), tab);
  } catch {
    /* swallow */
  }
}

interface Props {
  projectSlug: string;
  sections: SectionDef[];
}

export function TabbedWorkbench({ projectSlug, sections }: Props) {
  const [active, setActive] = React.useState<WorkbenchTabId>("now");

  // Hydrate the active tab from localStorage after mount so SSR + first
  // client render match.
  React.useEffect(() => {
    setActive(readActiveTab(projectSlug));
  }, [projectSlug]);

  const sectionById = React.useMemo(() => {
    const map = new Map<string, SectionDef>();
    for (const s of sections) map.set(s.id, s);
    return map;
  }, [sections]);

  const sectionsForTab = React.useCallback(
    (tab: WorkbenchTabId): SectionDef[] => {
      const ordered: SectionDef[] = [];
      const seen = new Set<string>();
      for (const id of TAB_ORDER[tab]) {
        const s = sectionById.get(id);
        if (s) {
          ordered.push(s);
          seen.add(id);
        }
      }
      // Catch-all: any section whose id has no entry in SECTION_TAB_MAP
      // falls into "now" so newly-added sections are visible until they
      // get an explicit assignment.
      if (tab === "now") {
        for (const s of sections) {
          if (!seen.has(s.id) && !SECTION_TAB_MAP[s.id]) ordered.push(s);
        }
      }
      return ordered;
    },
    [sections, sectionById],
  );

  function selectTab(next: WorkbenchTabId) {
    setActive(next);
    writeActiveTab(projectSlug, next);
  }

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Workbench sections"
        className="bg-background/95 backdrop-blur sticky top-[var(--workbench-header-h,8rem)] z-20 -mx-3 flex items-center gap-1 border-b px-3 py-1.5"
      >
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(tab.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "bg-background text-foreground border-input border shadow-sm"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {TABS.map((tab) => {
        const tabSections = sectionsForTab(tab.id);
        return (
          <div
            key={tab.id}
            role="tabpanel"
            aria-labelledby={`tab-${tab.id}`}
            hidden={tab.id !== active}
          >
            {tabSections.length > 0 ? (
              <SectionList scope={tab.scope} sections={tabSections} />
            ) : (
              <p className="text-muted-foreground px-3 py-8 text-center text-sm italic">
                Nothing in {tab.label} for this project yet.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
