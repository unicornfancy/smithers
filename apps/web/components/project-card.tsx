import * as React from "react";
import Link from "next/link";
import {
  CircleAlert,
  CircleDot,
  ExternalLink,
  FolderKanban,
  Sparkles,
  Users,
} from "lucide-react";

import type { Project, ProjectKind, ProjectStatus } from "@smithers/vault";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const KIND_LABEL: Record<ProjectKind, string> = {
  partner: "Partner",
  team: "Team",
  personal: "Personal",
};

const KIND_ICON: Record<ProjectKind, React.ComponentType<{ className?: string }>> =
  {
    partner: Users,
    team: Sparkles,
    personal: FolderKanban,
  };

const STATUS_TONE: Record<
  ProjectStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  research: "outline",
  planning: "outline",
  active: "secondary",
  hot: "destructive",
  secondary: "outline",
  cold: "outline",
  "at-risk": "destructive",
  launched: "secondary",
  archived: "outline",
};

export function ProjectCard({ project }: { project: Project }) {
  const Icon = KIND_ICON[project.kind];
  const quickLinks = collectQuickLinks(project);

  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group bg-card hover:bg-accent/30 flex flex-col gap-3 rounded-xl border p-5 shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
            <Icon className="size-4" />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="text-foreground truncate text-base font-semibold leading-tight">
              {project.name}
            </h3>
            <p className="text-muted-foreground truncate text-xs">
              {project.slug}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge variant="outline" className="text-[10px] uppercase">
            {KIND_LABEL[project.kind]}
          </Badge>
          <Badge variant={STATUS_TONE[project.status]} className="text-[10px]">
            {project.status === "at-risk" ? (
              <CircleAlert className="size-3" />
            ) : (
              <CircleDot className="size-3" />
            )}
            {project.status}
          </Badge>
        </div>
      </div>

      {project.heading && project.heading !== project.name ? (
        <p className="text-muted-foreground line-clamp-2 text-sm">
          {project.heading}
        </p>
      ) : null}

      {quickLinks.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {quickLinks.map((q) => (
            <span
              key={q.label}
              className={cn(
                "bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
              )}
            >
              <ExternalLink className="size-3" />
              {q.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="text-muted-foreground/70 mt-auto flex items-center justify-between gap-3 text-[11px]">
        <span>updated {formatDate(project.modified_at)}</span>
        {project.partner ? <span>{project.partner}</span> : null}
      </div>
    </Link>
  );
}

interface QuickLink {
  label: string;
}

function collectQuickLinks(p: Project): QuickLink[] {
  const out: QuickLink[] = [];
  if (p.p2_url) out.push({ label: "P2" });
  if (p.github_repo) out.push({ label: "GitHub" });
  if (p.linear_project_id || p.linear_project_slug) out.push({ label: "Linear" });
  const ticketCount = (p.zendesk_tickets ?? []).length;
  if (ticketCount > 0) {
    out.push({
      label: ticketCount > 1 ? `Zendesk · ${ticketCount}` : "Zendesk",
    });
  }
  if (p.staging_url) out.push({ label: "Staging" });
  if (p.production_url) out.push({ label: "Live" });
  if (p.primary_slack_channel) out.push({ label: p.primary_slack_channel });
  return out;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  const now = new Date();
  const diffMs = now.valueOf() - d.valueOf();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
