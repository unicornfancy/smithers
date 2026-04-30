import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Github,
  Hash,
  KanbanSquare,
  LifeBuoy,
  Server,
  ShieldAlert,
  Slack,
} from "lucide-react";

import { extractTicketId, zendeskTicketUrl } from "@smithers/mcp-client";
import type { Project, ProjectKind, ProjectStatus } from "@smithers/vault";

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

export function WorkbenchHeader({ project }: { project: Project }) {
  const links = collectQuickLinks(project);

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
    </header>
  );
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
    const primary = tickets[0]!;
    const primaryId = extractTicketId(primary) ?? primary;
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
  if (p.primary_slack_channel) {
    out.push({
      label: p.primary_slack_channel,
      href: `https://app.slack.com/client/T024FPGFE/${slackChannelSlug(p.primary_slack_channel)}`,
      icon: <Slack className="size-3.5" />,
    });
  }
  return out;
}

function slackChannelSlug(channel: string): string {
  // Slack deep-links use a name slug without leading `#`. We don't know the
  // channel id from the name alone, so we pass a generic search-like URL with
  // the bare name; Slack will redirect to the channel if it exists.
  return channel.replace(/^#+/, "");
}
