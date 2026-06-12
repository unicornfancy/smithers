"use client";

import * as React from "react";
import {
  Check,
  ClipboardCopy,
  ExternalLink,
  Github,
  ListChecks,
  Loader2,
  Square,
} from "lucide-react";
import { toast } from "sonner";

import {
  buildKoshIssueBodyAction,
  createKoshGhIssueAction,
} from "@/app/projects/[slug]/qa/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Severity = "critical" | "high" | "medium" | "low";

interface Finding {
  id: string;
  severity: Severity;
  category: string;
  issue: string;
  impact?: string;
  device?: string;
  pages?: string[];
  metric?: string;
}

interface Props {
  projectSlug: string;
  runId: string;
  findings: Finding[];
  githubRepo: string | null;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const SEVERITY_TONE: Record<Severity, string> = {
  critical:
    "bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900/60",
  high: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/60",
  medium:
    "bg-zinc-50 text-zinc-900 border-zinc-200 dark:bg-zinc-900/60 dark:text-zinc-200 dark:border-zinc-700",
  low: "bg-zinc-50 text-zinc-700 border-zinc-200 dark:bg-zinc-900/60 dark:text-zinc-400 dark:border-zinc-700",
};

export function QaFindingsIssueBuilder({
  projectSlug,
  runId,
  findings,
  githubRepo,
}: Props) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pending, setPending] = React.useState<"gh" | "copy" | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllOfSeverity(sev: Severity) {
    setSelected((prev) => {
      const next = new Set(prev);
      const ids = findings.filter((f) => f.severity === sev).map((f) => f.id);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function handleCopy() {
    if (selected.size === 0) {
      toast.error("Select at least one finding");
      return;
    }
    setPending("copy");
    try {
      const res = await buildKoshIssueBodyAction({
        run_id: runId,
        finding_ids: Array.from(selected),
      });
      if (!res.ok) {
        toast.error(res.message ?? res.reason);
        return;
      }
      try {
        await navigator.clipboard.writeText(
          `# ${res.data.title}\n\n${res.data.body}`,
        );
        toast.success("Issue markdown copied — paste into Linear or wherever");
      } catch {
        toast.error("Copy failed — your browser may block clipboard access");
      }
    } finally {
      setPending(null);
    }
  }

  async function handleCreateGh() {
    if (selected.size === 0) {
      toast.error("Select at least one finding");
      return;
    }
    if (!githubRepo) {
      toast.error("Project has no github_repo — use Copy markdown instead");
      return;
    }
    setPending("gh");
    try {
      const res = await createKoshGhIssueAction({
        project_slug: projectSlug,
        run_id: runId,
        finding_ids: Array.from(selected),
      });
      if (!res.ok) {
        toast.error(res.message ?? res.reason);
        return;
      }
      toast.success("GitHub issue created");
      window.open(res.data.url, "_blank", "noopener,noreferrer");
    } finally {
      setPending(null);
    }
  }

  // Group findings by severity for the per-section "select all" links.
  const groups: Record<Severity, Finding[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };
  for (const f of findings) groups[f.severity].push(f);

  if (findings.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="size-4" />
          Create issue from findings
          <span className="text-muted-foreground ml-auto text-xs font-normal">
            {selected.size}/{findings.length} selected
          </span>
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Check the items you want to address. Builds a single issue with the
          selected items as a checklist.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y rounded-md border">
          {(["critical", "high", "medium", "low"] as Severity[]).map((sev) => {
            const items = groups[sev];
            if (items.length === 0) return null;
            const allSelected = items.every((f) => selected.has(f.id));
            return (
              <div key={sev}>
                <div className="bg-muted/30 flex items-center justify-between px-3 py-1.5">
                  <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                    {SEVERITY_LABEL[sev]} · {items.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => selectAllOfSeverity(sev)}
                    className="text-muted-foreground hover:text-foreground text-xs"
                  >
                    {allSelected ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <ul className="divide-y">
                  {items.map((f) => (
                    <li key={f.id}>
                      <FindingRow
                        finding={f}
                        checked={selected.has(f.id)}
                        onToggle={() => toggle(f.id)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={handleCreateGh}
            disabled={pending !== null || selected.size === 0 || !githubRepo}
            title={
              githubRepo
                ? `Create issue in ${githubRepo}`
                : "Project has no github_repo set"
            }
            className="gap-1.5"
          >
            {pending === "gh" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Github className="size-3.5" />
            )}
            Create GitHub issue
            {githubRepo ? (
              <span className="text-muted-foreground/80 hidden font-normal sm:inline">
                · {githubRepo}
              </span>
            ) : null}
            <ExternalLink className="size-3 opacity-60" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopy}
            disabled={pending !== null || selected.size === 0}
            className="gap-1.5"
          >
            {pending === "copy" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ClipboardCopy className="size-3.5" />
            )}
            Copy as markdown
          </Button>
          {selected.size > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={clearAll}
              disabled={pending !== null}
              className="ml-auto text-xs"
            >
              Clear selection
            </Button>
          ) : null}
        </div>

        {!githubRepo ? (
          <p className="text-muted-foreground text-xs">
            No <code>github_repo</code> set on this project — use Copy markdown
            to paste into Linear or another tracker.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FindingRow({
  finding,
  checked,
  onToggle,
}: {
  finding: Finding;
  checked: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const hasDetail = Boolean(
    finding.impact || finding.metric || (finding.pages && finding.pages.length > 0),
  );
  return (
    <div className="flex items-start gap-3 px-3 py-2">
      <button
        type="button"
        onClick={onToggle}
        className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0"
        aria-pressed={checked}
        aria-label={checked ? "Deselect finding" : "Select finding"}
      >
        {checked ? (
          <Check className="text-foreground size-4" />
        ) : (
          <Square className="size-4" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span
            className={cn(
              "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              SEVERITY_TONE[finding.severity],
            )}
          >
            {finding.category}
          </span>
          <p className="text-sm leading-snug">{finding.issue}</p>
        </div>
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-muted-foreground hover:text-foreground mt-1 text-xs"
          >
            {expanded ? "Hide details" : "Show details"}
          </button>
        ) : null}
        {expanded ? (
          <div className="text-muted-foreground mt-1 space-y-0.5 text-xs">
            {finding.impact ? (
              <p>
                <span className="font-medium">Impact:</span> {finding.impact}
              </p>
            ) : null}
            {finding.metric ? (
              <p>
                <span className="font-medium">Metric:</span> {finding.metric}
              </p>
            ) : null}
            {finding.device ? (
              <p>
                <span className="font-medium">Device:</span> {finding.device}
              </p>
            ) : null}
            {finding.pages && finding.pages.length > 0 ? (
              <p>
                <span className="font-medium">Pages:</span>{" "}
                {finding.pages.map((p, i) => (
                  <React.Fragment key={p}>
                    {i > 0 ? " · " : ""}
                    <a
                      href={p}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-foreground underline"
                    >
                      {p}
                    </a>
                  </React.Fragment>
                ))}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
