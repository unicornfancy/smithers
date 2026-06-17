import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckSquare,
  ClipboardCheck,
  Clock,
  ExternalLink,
  Figma,
  FolderOpen,
  Github,
  Hash,
  Inbox,
  KanbanSquare,
  LifeBuoy,
  Server,
  ShieldAlert,
  Slack,
  Ticket,
} from "lucide-react";

import { zendeskTicketUrl } from "@smithers/mcp-client";
import type { Project, ProjectKind, ProjectStatus } from "@smithers/vault";

import { GenerateHandoffButton } from "@/components/generate-handoff-button";
import { ProjectMetadataModal } from "@/components/project-metadata-modal";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const KIND_LABEL: Record<ProjectKind, string> = {
  partner: "Partner",
  team: "Team",
  personal: "Personal",
};

const STATUS_VARIANT: Record<
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

export interface WorkbenchCounts {
  open_tasks: number;
  open_follow_ups: number;
  zendesk_tickets: number;
  /** ISO timestamp of the project's last modification (file mtime). */
  last_touched_at: string;
}

export function WorkbenchHeader({
  project,
  preparedBy,
  counts,
}: {
  project: Project;
  /** Default value for the handoff dialog's "Prepared by" field — usually identity.name from config. */
  preparedBy: string;
  /**
   * Quick-stat counts rendered as a chips row at the bottom of the
   * sticky header. Omit on pages where the data isn't easily available;
   * the row is hidden when absent so the existing single-row header
   * survives.
   */
  counts?: WorkbenchCounts;
}) {
  const links = collectQuickLinks(project);
  const hmConnected = Boolean(project.hive_mind_partner_slug);

  return (
    <header className="bg-background/85 sticky top-0 z-30 flex flex-col gap-2 border-b px-6 py-3 backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="-ml-2 size-8">
            <Link href="/projects" aria-label="Back to projects">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="text-foreground truncate text-base font-semibold leading-tight">
                {project.name}
              </h1>
              {project.nda ? (
                <Badge variant="outline" className="gap-1 text-[10px] uppercase">
                  <ShieldAlert className="size-3" />
                  NDA
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground truncate text-xs">
              {project.slug}
              {project.partner ? ` · ${project.partner}` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] uppercase">
            {KIND_LABEL[project.kind]}
          </Badge>
          <Badge
            variant={STATUS_VARIANT[project.status]}
            className="text-[10px]"
          >
            {project.status}
          </Badge>
          {hmConnected ? (
            <GenerateHandoffButton
              projectSlug={project.slug}
              defaultPreparedBy={preparedBy}
              variant="ghost"
              label="Handoff"
            />
          ) : null}
          <Button variant="ghost" size="sm" asChild className="gap-1.5">
            <Link href={`/projects/${project.slug}/qa`}>
              <ClipboardCheck className="size-4" />
              QA
            </Link>
          </Button>
          <ProjectMetadataModal project={project} />
          <ThemeToggle />
        </div>
      </div>

      {links.length > 0 ? (
        <nav className="-mx-1 flex flex-wrap gap-1">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors"
            >
              {l.icon}
              <span className="font-medium">{l.label}</span>
              <ExternalLink className="size-3 opacity-60" />
            </a>
          ))}
        </nav>
      ) : null}

      {counts ? <CountsRow counts={counts} /> : null}
    </header>
  );
}

function CountsRow({ counts }: { counts: WorkbenchCounts }) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-[11px]">
      <CountChip
        icon={<CheckSquare className="size-3" />}
        label="open tasks"
        value={counts.open_tasks}
      />
      <CountChip
        icon={<Inbox className="size-3" />}
        label="follow-ups"
        value={counts.open_follow_ups}
      />
      <CountChip
        icon={<Ticket className="size-3" />}
        label="ZD tickets"
        value={counts.zendesk_tickets}
      />
      <span className="text-muted-foreground/80 inline-flex items-center gap-1">
        <Clock className="size-3" />
        last touched {formatRelative(counts.last_touched_at)}
      </span>
    </div>
  );
}

function CountChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {icon}
      <span className="text-foreground font-medium tabular-nums">{value}</span>{" "}
      {label}
    </span>
  );
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 10);
  const diffMs = Date.now() - t;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return iso.slice(0, 10);
}

interface QuickLink {
  label: string;
  href: string;
  icon: React.ReactNode;
}

function collectQuickLinks(p: Project): QuickLink[] {
  const out: QuickLink[] = [];
  if (p.p2_url) {
    out.push({
      label: "P2",
      href: p.p2_url,
      icon: <Hash className="size-3.5" />,
    });
  }
  if (p.github_repo) {
    out.push({
      label: p.github_repo,
      href: `https://github.com/${p.github_repo}`,
      icon: <Github className="size-3.5" />,
    });
  }
  if (p.linear_project_slug) {
    out.push({
      label: "Linear",
      href: `https://linear.app/${p.linear_project_slug}`,
      icon: <KanbanSquare className="size-3.5" />,
    });
  } else if (p.linear_project_id) {
    out.push({
      label: "Linear",
      href: `https://linear.app/team51/project/${p.linear_project_id}`,
      icon: <KanbanSquare className="size-3.5" />,
    });
  }
  const tickets = p.zendesk_tickets ?? [];
  if (tickets.length > 0) {
    // Link the header pill at the primary thread; the workbench's
    // ZendeskThreadsPanel surfaces the rest with their own links.
    const primaryId = tickets[0]!.id;
    out.push({
      label: tickets.length > 1 ? `Zendesk · ${tickets.length}` : "Zendesk",
      href: zendeskTicketUrl(primaryId),
      icon: <LifeBuoy className="size-3.5" />,
    });
  }
  if (p.staging_url) {
    out.push({
      label: "Staging",
      href: p.staging_url,
      icon: <Server className="size-3.5" />,
    });
  }
  if (p.production_url) {
    out.push({
      label: "Live",
      href: p.production_url,
      icon: <ExternalLink className="size-3.5" />,
    });
  }
  if (p.figma_url) {
    out.push({
      label: "Figma",
      href: p.figma_url,
      icon: <Figma className="size-3.5" />,
    });
  }
  if (p.google_drive_url) {
    out.push({
      label: "Drive",
      href: p.google_drive_url,
      icon: <FolderOpen className="size-3.5" />,
    });
  }
  if (p.slack_channel) {
    const link = slackChannelLink(p.slack_channel);
    out.push({
      label: link.label,
      href: link.href,
      icon: <Slack className="size-3.5" />,
    });
  }
  return out;
}

/**
 * Build a chip-ready label + href for the `slack_channel` frontmatter
 * value. Accepts three forms:
 *   - A bare name (`team-51` / `#team-51`) — deep-link to Slack search.
 *   - A channel-archive URL (`https://<ws>.slack.com/archives/<id>`) —
 *     link straight at the URL, label down to "Slack · <id>".
 *   - A bare ID (`C0981BSREQ0`) — link via the standard client URL.
 */
function slackChannelLink(value: string): { label: string; href: string } {
  const trimmed = value.trim();
  const urlMatch = /^https?:\/\/[^/]+\.slack\.com\/archives\/([A-Z0-9]{8,})/i.exec(
    trimmed,
  );
  if (urlMatch) {
    return { label: `Slack · ${urlMatch[1]}`, href: trimmed };
  }
  if (/^[CG][A-Z0-9]{8,}$/.test(trimmed)) {
    return {
      label: `Slack · ${trimmed}`,
      href: `https://app.slack.com/client/T024FPGFE/${trimmed}`,
    };
  }
  const name = trimmed.replace(/^#+/, "");
  return {
    label: `#${name}`,
    href: `https://app.slack.com/client/T024FPGFE/${name}`,
  };
}
