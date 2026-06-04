"use client";

import * as React from "react";
import { Columns3, LayoutGrid } from "lucide-react";

import { useWorkbenchLayout, type WorkbenchLayout } from "@/lib/use-workbench-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{
  id: WorkbenchLayout;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "single-page",
    label: "Single page (original)",
    description:
      "Every card on one long scroll. Use Edit layout to reorder or hide individual sections.",
    icon: LayoutGrid,
  },
  {
    id: "tabs",
    label: "Tabs",
    description:
      "Four tabs (Now / Comms / Knowledge / Drafts) split the page so each view is focused. The sticky header still shows project counts at a glance regardless of tab.",
    icon: Columns3,
  },
];

export function WorkbenchLayoutCard() {
  const [layout, setLayout] = useWorkbenchLayout();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Workbench layout</CardTitle>
        <p className="text-muted-foreground text-xs">
          Pick how each project page lays out. Persists per browser; reorder/hide
          within a tab is independent of the single-page section order.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {OPTIONS.map((opt) => {
          const isActive = layout === opt.id;
          const Icon = opt.icon;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setLayout(opt.id)}
              className={cn(
                "flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors",
                isActive
                  ? "border-foreground/40 bg-accent/40"
                  : "border-input hover:bg-accent/20",
              )}
              aria-pressed={isActive}
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md",
                  isActive
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {opt.label}
                  {isActive ? (
                    <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                      Active
                    </span>
                  ) : null}
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
                  {opt.description}
                </p>
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
