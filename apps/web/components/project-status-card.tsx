"use client";

import { ExternalLink } from "lucide-react";

import type { LinearIssue, LinearProject } from "@smithers/mcp-client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  linearProject: LinearProject;
  linearPhaseIssues: LinearIssue[];
  activePhaseSubtasks: LinearIssue[];
}

export function ProjectStatusCard({
  linearProject,
  linearPhaseIssues,
  activePhaseSubtasks,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="font-semibold">{linearProject.name}</span>
          <StateBadge state={linearProject.state.name} />
          <HealthBadge health={linearProject.health} />
          <a
            href={linearProject.url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1 text-xs font-normal"
            aria-label="View in Linear"
          >
            <ExternalLink className="size-3" />
            Linear
          </a>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ProgressBar percent={linearProject.progress} />

        <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
          {(linearProject.startDate || linearProject.targetDate) ? (
            <span>
              {linearProject.startDate ?? "—"}
              {" → "}
              {linearProject.targetDate ?? "—"}
            </span>
          ) : null}
          {linearProject.lead ? (
            <span>Lead: {linearProject.lead.displayName}</span>
          ) : null}
        </div>

        {linearPhaseIssues.length > 0 ? (
          <div>
            <p className="text-muted-foreground mb-1.5 text-[11px] font-medium uppercase tracking-wide">
              Phases
            </p>
            <ul className="flex flex-col divide-y">
              {linearPhaseIssues.map((issue) => {
                const isActive = issue.state.type === "started";
                const subtasks = isActive ? activePhaseSubtasks : [];
                return (
                  <li key={issue.identifier} className="py-1.5 first:pt-0">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-[10px] font-mono shrink-0">
                        {issue.team.key}-{issue.identifier.split("-")[1]}
                      </span>
                      <span
                        className={cn(
                          "flex-1 text-sm leading-snug",
                          !isActive && "text-muted-foreground",
                        )}
                      >
                        {issue.title}
                      </span>
                      <IssueBadge state={issue.state} />
                      {issue.assignee ? (
                        <span className="text-muted-foreground shrink-0 text-[11px]">
                          {issue.assignee.displayName}
                        </span>
                      ) : null}
                    </div>
                    {subtasks.length > 0 ? (
                      <ul className="mt-1 ml-4 flex flex-col gap-0.5 border-l pl-3">
                        {subtasks.map((sub) => (
                          <li
                            key={sub.identifier}
                            className="flex items-center gap-2 text-xs"
                          >
                            <span className="text-muted-foreground font-mono text-[10px] shrink-0">
                              {sub.identifier}
                            </span>
                            <span className="flex-1 text-muted-foreground leading-snug">
                              {sub.title}
                            </span>
                            <IssueBadge state={sub.state} small />
                            {sub.assignee ? (
                              <span className="text-muted-foreground/70 shrink-0 text-[11px]">
                                {sub.assignee.displayName}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent * 100)));
  return (
    <div className="space-y-1">
      <div className="bg-muted h-1.5 w-full rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-500 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-muted-foreground text-[11px]">{pct}% complete</p>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const lower = state.toLowerCase();
  const styles: Record<string, string> = {
    started: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    inprogress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    cancelled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    canceled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    paused: "bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-300",
  };
  const cls =
    styles[lower] ??
    "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        cls,
      )}
    >
      {state}
    </span>
  );
}

function HealthBadge({ health }: { health: string }) {
  const styles: Record<string, string> = {
    onTrack: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    atRisk: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    offTrack: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  const label: Record<string, string> = {
    onTrack: "On Track",
    atRisk: "At Risk",
    offTrack: "Off Track",
  };
  const cls = styles[health] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
        cls,
      )}
    >
      {label[health] ?? health}
    </span>
  );
}

function IssueBadge({
  state,
  small = false,
}: {
  state: { name: string; type: string };
  small?: boolean;
}) {
  const type = state.type.toLowerCase();
  const styles: Record<string, string> = {
    started: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    cancelled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    canceled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  const cls = styles[type] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1 py-0.5 font-medium uppercase tracking-wide",
        small ? "text-[9px]" : "text-[10px]",
        cls,
      )}
    >
      {state.name}
    </span>
  );
}
