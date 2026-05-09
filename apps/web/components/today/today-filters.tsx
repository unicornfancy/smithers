"use client";

import { CircleDot, Github, LifeBuoy, MessageSquare, Pin, Sparkles, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type PingSource = "slack" | "zendesk" | "github" | "linear" | "p2";
const ALL_SOURCES: PingSource[] = ["slack", "zendesk", "github", "linear", "p2"];

/**
 * Source + scope filter chips at the top of /today. State lives in the
 * URL search params so filters are deep-linkable and survive the server
 * re-render — `?source=slack,zendesk&pinned=1`. The page reads the
 * params in its function signature and pre-filters the data it hands
 * to each section.
 *
 * Multi-select toggle: clicking a source flips it in/out of the active
 * set. With nothing selected, all sources are shown (default). The
 * "Pinned only" toggle scopes Hot pings + Moving fast to projects with
 * priority: high.
 */
export function TodayFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSources = parseSources(searchParams.get("source"));
  const pinnedOnly = searchParams.get("pinned") === "1";
  const isFiltering = activeSources.size > 0 || pinnedOnly;

  function updateParams(mutate: (sp: URLSearchParams) => void) {
    const sp = new URLSearchParams(searchParams.toString());
    mutate(sp);
    const qs = sp.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }

  function toggleSource(source: PingSource) {
    const next = new Set(activeSources);
    if (next.has(source)) next.delete(source);
    else next.add(source);
    updateParams((sp) => {
      if (next.size === 0) sp.delete("source");
      else sp.set("source", Array.from(next).join(","));
    });
  }

  function togglePinned() {
    updateParams((sp) => {
      if (pinnedOnly) sp.delete("pinned");
      else sp.set("pinned", "1");
    });
  }

  function clearAll() {
    updateParams((sp) => {
      sp.delete("source");
      sp.delete("pinned");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ALL_SOURCES.map((s) => (
        <SourceChip
          key={s}
          source={s}
          active={activeSources.has(s)}
          onToggle={() => toggleSource(s)}
        />
      ))}
      <span className="text-muted-foreground/40 mx-1 text-xs">|</span>
      <ScopeChip
        label="Pinned only"
        icon={<Pin className="size-3" />}
        active={pinnedOnly}
        onToggle={togglePinned}
        title="Show only Hot pings + Moving fast for projects with priority: high"
      />
      {isFiltering ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground ml-auto h-6 gap-1 px-1.5 text-[11px]"
          onClick={clearAll}
          title="Clear all filters"
        >
          <X className="size-3" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}

function SourceChip({
  source,
  active,
  onToggle,
}: {
  source: PingSource;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-input text-muted-foreground hover:text-foreground hover:border-foreground/40",
      )}
      title={`Toggle ${SOURCE_LABELS[source]} filter`}
    >
      <SourceIcon source={source} />
      {SOURCE_LABELS[source]}
    </button>
  );
}

function ScopeChip({
  label,
  icon,
  active,
  onToggle,
  title,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
        active
          ? "border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-100"
          : "border-input text-muted-foreground hover:text-foreground hover:border-foreground/40",
      )}
      title={title}
    >
      {icon}
      {label}
    </button>
  );
}

function SourceIcon({ source }: { source: PingSource }) {
  switch (source) {
    case "slack":
      return <MessageSquare className="size-3" />;
    case "zendesk":
      return <LifeBuoy className="size-3" />;
    case "github":
      return <Github className="size-3" />;
    case "linear":
      return <CircleDot className="size-3" />;
    case "p2":
      return <Sparkles className="size-3" />;
  }
}

const SOURCE_LABELS: Record<PingSource, string> = {
  slack: "Slack",
  zendesk: "Zendesk",
  github: "GitHub",
  linear: "Linear",
  p2: "P2",
};

function parseSources(raw: string | null): Set<PingSource> {
  if (!raw) return new Set();
  const out = new Set<PingSource>();
  for (const s of raw.split(",")) {
    const trimmed = s.trim().toLowerCase();
    if (ALL_SOURCES.includes(trimmed as PingSource)) {
      out.add(trimmed as PingSource);
    }
  }
  return out;
}
