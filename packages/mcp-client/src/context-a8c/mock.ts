// Deterministic mock transport for ContextA8C.
//
// Activity is generated from the project's linked refs (github_repo, linear,
// slack, zendesk, p2). Same project + same UTC day → same events, so the UI
// is stable across reloads while still feeling alive day to day.

import type { ActivityEvent, Ping } from "../types";
import { createRng, dailySeed, pickN } from "../seed";
import type {
  ActivitySourceFilter,
  ContextA8CClient,
  PingsQuery,
  ProjectActivityQuery,
} from "./types";
import { extractTicketId } from "./zendesk-refs";
import type { SourceResult } from "../types";
import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { runIsolated } from "../isolation";

const INTERNAL_PEOPLE = [
  { name: "Riley Chen", handle: "riley", email: "riley@automattic.com" },
  { name: "Avery Park", handle: "avery", email: "avery@automattic.com" },
  { name: "Sam Okafor", handle: "sam", email: "sam@automattic.com" },
  { name: "Jamie Liu", handle: "jamie", email: "jamie@automattic.com" },
] as const;

const EXTERNAL_PEOPLE_BY_PARTNER: Record<
  string,
  { name: string; handle: string; email: string }[]
> = {
  default: [
    { name: "Morgan Reed", handle: "morgan", email: "morgan@partner.org" },
    { name: "Casey Brooks", handle: "casey", email: "casey@partner.org" },
  ],
};

const SLACK_PHRASES = [
  "Quick check — does the staging build look right to you?",
  "Pushed a fix for the layout issue, give it a look when you get a sec",
  "Heads up: stakeholder review moved to Thursday",
  "Anyone have context on the donor flow regression?",
  "Sharing the latest design pass for review",
  "Stand-up reminder for tomorrow morning",
];

const COMMIT_PHRASES = [
  "Fix accessible label on donate CTA",
  "Tighten loading skeleton for project list",
  "Bump dependencies and lock file",
  "Refactor partner card to share with workbench",
  "Add staging deploy preview for footer changes",
  "Rework navigation breakpoints",
];

const PR_TITLES = [
  "Donate flow polish",
  "Footer accessibility pass",
  "Project workbench feedback round",
  "Partner profile data migration",
  "Editorial calendar import",
];

const LINEAR_TITLES = [
  "Design review for hero variants",
  "Spec donor receipt copy",
  "QA: tabbed navigation focus order",
  "Audit color contrast in dark mode",
  "Move milestones to deadlines.md",
];

const P2_TITLES = [
  "Partner check-in: notes from this week",
  "Launch readiness — outstanding items",
  "Review: phase 2 site map",
  "Decision: archive the old microsite?",
];

const ZENDESK_SUBJECTS = [
  "Question about content publishing flow",
  "Donation receipts not delivering",
  "Help configuring custom domain",
  "Feature request: editorial dashboard",
];

export class MockContextA8CTransport implements ContextA8CClient {
  constructor(
    private readonly opts: ResolvedMcpClientOptions,
    private readonly cache: SwrCache,
    private readonly health: HealthRegistry,
  ) {}

  async listProjectActivity(
    query: ProjectActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>> {
    const cacheKey = `mock:context_a8c:activity:${query.project_slug}:${query.limit ?? 20}:${query.since ?? "*"}:${(query.sources ?? []).join(",")}`;
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "context_a8c.slack",
        cacheKey,
        ttl: this.opts.ttl.activity,
        fetcher: async () => this.generateActivity(query),
      },
    );
  }

  async fetchZendeskTicketSummary(
    ticketRef: string,
  ): Promise<{
    id: string;
    subject: string | null;
    status: string | null;
    priority: string | null;
    updated_at: string | null;
    url: string;
  } | null> {
    const id = extractTicketId(ticketRef) ?? ticketRef;
    if (!id || !/^\d+$/.test(id)) return null;
    // Deterministic seeded values so demo screenshots stay stable.
    const rng = createRng(dailySeed(`zendesk-ticket:${id}`));
    const subjects = [
      "Plan dashboard polish",
      "Donor flow regression check",
      "Layout adjustments — accessible",
      "Phase 2 data import handoff",
    ];
    const statuses = ["open", "pending", "open", "solved"];
    const subj = subjects[Math.floor(rng() * subjects.length)]!;
    const status = statuses[Math.floor(rng() * statuses.length)]!;
    const updatedDaysAgo = 1 + Math.floor(rng() * 14);
    return {
      id,
      subject: subj,
      status,
      priority: "normal",
      updated_at: new Date(
        Date.now() - updatedDaysAgo * 24 * 60 * 60 * 1000,
      ).toISOString(),
      url: `https://automattic.zendesk.com/agent/tickets/${id}`,
    };
  }

  async fetchZendeskTicketActivity(
    ticketRef: string,
    opts: { limit?: number; projectSlug?: string } = {},
  ): Promise<ActivityEvent[]> {
    const id = extractTicketId(ticketRef) ?? ticketRef;
    if (!id || !/^\d+$/.test(id)) return [];
    const limit = Math.max(1, Math.min(50, opts.limit ?? 10));
    const rng = createRng(dailySeed(`zendesk-activity:${id}`));
    const count = Math.min(limit, 1 + Math.floor(rng() * 4));
    const now = Date.now();
    const out: ActivityEvent[] = [];
    for (let i = 0; i < count; i++) {
      const isExternal = rng() < 0.6;
      const daysAgo = i + Math.floor(rng() * 3);
      const ts = new Date(now - daysAgo * 86_400_000).toISOString();
      out.push({
        id: `mock:zendesk:${id}:c${i}`,
        source: "zendesk",
        kind: "zendesk-comment",
        timestamp: ts,
        actor: isExternal
          ? {
              name: "Partner contact",
              handle: "partner",
              is_external: true,
            }
          : {
              name: "Riley Chen",
              handle: "riley",
              is_external: false,
            },
        title: `Reply on ticket #${id}`,
        excerpt: isExternal
          ? "Thanks — we tested again and the issue persists on mobile."
          : "Looped in the team; will follow up tomorrow with a workaround.",
        url: `https://automattic.zendesk.com/agent/tickets/${id}`,
        project_match: opts.projectSlug
          ? { project_slug: opts.projectSlug, matched_by: "zendesk_ticket" }
          : undefined,
        is_mock: true,
      });
    }
    return out;
  }

  async searchZendeskTickets(
    query: string,
    opts: { limit?: number } = {},
  ): Promise<
    | { ok: true; tickets: import("./types").ZendeskTicketSummary[] }
    | { ok: false; error: string }
  > {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return { ok: true, tickets: [] };
    const limit = Math.max(1, Math.min(50, opts.limit ?? 20));
    // Deterministic seed off the query so the same input gives stable
    // results between renders/screenshots.
    const rng = createRng(dailySeed(`zendesk-search:${trimmed}`));
    const subjects = [
      `${capitalize(trimmed)} — escalation thread`,
      `Plan dashboard polish for ${capitalize(trimmed)}`,
      `${capitalize(trimmed)} donor flow regression`,
      `Layout adjustments — ${capitalize(trimmed)}`,
      `Phase 2 data import for ${capitalize(trimmed)}`,
      `Billing question from ${capitalize(trimmed)} team`,
    ];
    const statuses = ["open", "pending", "open", "solved", "open"];
    const count = Math.min(subjects.length, limit, 1 + Math.floor(rng() * 5));
    const tickets = Array.from({ length: count }, (_, i) => {
      const id = String(11000000 + Math.floor(rng() * 99999));
      const updatedDaysAgo = 1 + Math.floor(rng() * 30);
      return {
        id,
        subject: subjects[i] ?? `${capitalize(trimmed)} ticket #${i + 1}`,
        status: statuses[i % statuses.length] ?? null,
        priority: "normal",
        updated_at: new Date(
          Date.now() - updatedDaysAgo * 24 * 60 * 60 * 1000,
        ).toISOString(),
        url: `https://automattic.zendesk.com/agent/tickets/${id}`,
      };
    });
    return { ok: true, tickets };
  }

  async listPings(query: PingsQuery): Promise<SourceResult<Ping[]>> {
    const cacheKey = `mock:context_a8c:pings:${query.limit ?? 25}:${query.since ?? "*"}:${(query.sources ?? []).join(",")}`;
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "context_a8c.slack",
        cacheKey,
        ttl: this.opts.ttl.pings,
        fetcher: async () => this.generatePings(query),
      },
    );
  }

  private generateActivity(query: ProjectActivityQuery): ActivityEvent[] {
    const rng = createRng(dailySeed(`activity:${query.project_slug}`));
    const limit = query.limit ?? 20;
    const allow = (s: ActivitySourceFilter) =>
      !query.sources || query.sources.length === 0 || query.sources.includes(s);

    const events: ActivityEvent[] = [];
    const now = Date.now();

    if (query.refs.github_repo && allow("github")) {
      const commitCount = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < commitCount; i += 1) {
        const minutesAgo = 30 + Math.floor(rng() * 4 * 60);
        const phrase = pickN(rng, COMMIT_PHRASES, 1)[0]!;
        const actor = pickN(rng, INTERNAL_PEOPLE, 1)[0]!;
        events.push({
          id: `gh-commit:${query.project_slug}:${i}`,
          source: "github",
          kind: "commit",
          timestamp: new Date(now - minutesAgo * 60_000).toISOString(),
          actor: {
            name: actor.name,
            handle: actor.handle,
            is_external: false,
          },
          title: phrase,
          excerpt: `${query.refs.github_repo} • ${phrase.toLowerCase()}`,
          url: `https://github.com/${query.refs.github_repo}/commit/${shortHash(rng)}`,
          project_match: {
            project_slug: query.project_slug,
            matched_by: "github_repo",
          },
          is_mock: true,
        });
      }
      if (rng() < 0.7) {
        const hoursAgo = 1 + Math.floor(rng() * 24);
        const title = pickN(rng, PR_TITLES, 1)[0]!;
        const actor = pickN(rng, INTERNAL_PEOPLE, 1)[0]!;
        events.push({
          id: `gh-pr:${query.project_slug}:1`,
          source: "github",
          kind: rng() < 0.5 ? "pr-opened" : "pr-merged",
          timestamp: new Date(now - hoursAgo * 60 * 60_000).toISOString(),
          actor: {
            name: actor.name,
            handle: actor.handle,
            is_external: false,
          },
          title,
          excerpt: `Pull request in ${query.refs.github_repo}`,
          url: `https://github.com/${query.refs.github_repo}/pull/${100 + Math.floor(rng() * 50)}`,
          project_match: {
            project_slug: query.project_slug,
            matched_by: "github_repo",
          },
          is_mock: true,
        });
      }
    }

    if (query.refs.linear_project_slug && allow("linear")) {
      const issueCount = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < issueCount; i += 1) {
        const hoursAgo = 1 + Math.floor(rng() * 36);
        const title = pickN(rng, LINEAR_TITLES, 1)[0]!;
        const actor = pickN(rng, INTERNAL_PEOPLE, 1)[0]!;
        const kinds = [
          "linear-issue-created",
          "linear-issue-updated",
          "linear-issue-completed",
        ] as const;
        events.push({
          id: `linear:${query.project_slug}:${i}`,
          source: "linear",
          kind: pickN(rng, kinds, 1)[0]!,
          timestamp: new Date(now - hoursAgo * 60 * 60_000).toISOString(),
          actor: {
            name: actor.name,
            handle: actor.handle,
            is_external: false,
          },
          title,
          excerpt: `Issue in ${query.refs.linear_project_slug}`,
          url: `https://linear.app/automattic/project/${query.refs.linear_project_slug}`,
          project_match: {
            project_slug: query.project_slug,
            matched_by: "linear_project",
          },
          is_mock: true,
        });
      }
    }

    if (query.refs.primary_slack_channel && allow("slack")) {
      const messageCount = 2 + Math.floor(rng() * 3);
      const partner = query.refs.partner ?? "default";
      const externals =
        EXTERNAL_PEOPLE_BY_PARTNER[partner] ??
        EXTERNAL_PEOPLE_BY_PARTNER.default!;
      for (let i = 0; i < messageCount; i += 1) {
        const minutesAgo = 15 + Math.floor(rng() * 6 * 60);
        const fromExternal = !!query.refs.partner && rng() < 0.4;
        const actor = fromExternal
          ? pickN(rng, externals, 1)[0]!
          : pickN(rng, INTERNAL_PEOPLE, 1)[0]!;
        const phrase = pickN(rng, SLACK_PHRASES, 1)[0]!;
        events.push({
          id: `slack:${query.project_slug}:${i}`,
          source: "slack",
          kind: "message",
          timestamp: new Date(now - minutesAgo * 60_000).toISOString(),
          actor: {
            name: actor.name,
            handle: actor.handle,
            is_external: fromExternal,
          },
          title: phrase,
          excerpt: `#${query.refs.primary_slack_channel}`,
          project_match: {
            project_slug: query.project_slug,
            matched_by: "slack_channel",
          },
          is_mock: true,
        });
      }
    }

    if (query.refs.p2_url && allow("p2")) {
      const hoursAgo = 4 + Math.floor(rng() * 3 * 24);
      const title = pickN(rng, P2_TITLES, 1)[0]!;
      const actor = pickN(rng, INTERNAL_PEOPLE, 1)[0]!;
      events.push({
        id: `p2:${query.project_slug}`,
        source: "p2",
        kind: rng() < 0.5 ? "p2-post" : "p2-comment",
        timestamp: new Date(now - hoursAgo * 60 * 60_000).toISOString(),
        actor: {
          name: actor.name,
          handle: actor.handle,
          is_external: false,
        },
        title,
        url: query.refs.p2_url,
        excerpt: `New activity on ${new URL(query.refs.p2_url).hostname}`,
        project_match: {
          project_slug: query.project_slug,
          matched_by: "p2_url",
        },
        is_mock: true,
      });
    }

    const tickets = query.refs.zendesk_tickets ?? [];
    if (tickets.length > 0 && allow("zendesk")) {
      // One mock comment per configured ticket so the workbench shows
      // the fan-out shape even in demo mode.
      tickets.forEach((ticketRef, i) => {
        if (rng() >= 0.6) return;
        const ticketId = extractTicketId(ticketRef) ?? ticketRef;
        const hoursAgo = 6 + Math.floor(rng() * 4 * 24);
        const subj = pickN(rng, ZENDESK_SUBJECTS, 1)[0]!;
        const partner = query.refs.partner ?? "default";
        const externals =
          EXTERNAL_PEOPLE_BY_PARTNER[partner] ??
          EXTERNAL_PEOPLE_BY_PARTNER.default!;
        const actor = pickN(rng, externals, 1)[0]!;
        events.push({
          id: `zendesk:${query.project_slug}:${ticketId}:${i}`,
          source: "zendesk",
          kind: "zendesk-ticket",
          timestamp: new Date(now - hoursAgo * 60 * 60_000).toISOString(),
          actor: {
            name: actor.name,
            handle: actor.handle,
            is_external: true,
          },
          title: subj,
          excerpt: `Ticket #${ticketId}`,
          project_match: {
            project_slug: query.project_slug,
            matched_by: "zendesk_ticket",
          },
          is_mock: true,
        });
      });
    }

    events.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    return events.slice(0, limit);
  }

  private generatePings(query: PingsQuery): Ping[] {
    const rng = createRng(dailySeed("pings:global"));
    const limit = query.limit ?? 25;
    const now = Date.now();
    const allow = (s: "slack" | "p2" | "zendesk") =>
      !query.sources || query.sources.length === 0 || query.sources.includes(s);

    const partners = Object.keys(EXTERNAL_PEOPLE_BY_PARTNER).filter(
      (p) => p !== "default",
    );
    const seedPartners =
      partners.length > 0 ? partners : ["climatefirst-foundation"];

    const out: Ping[] = [];
    const samples = [
      {
        source: "slack" as const,
        slug: "climatefirst-foundation-phase-2",
        excerpt:
          "Looping back — were you able to get a draft of the launch announcement together?",
      },
      {
        source: "p2" as const,
        slug: "opensource-initiative-q4",
        excerpt:
          "Heads up: I left a comment on the Phase 2 plan with some open questions before Friday",
      },
      {
        source: "zendesk" as const,
        slug: "climatefirst-foundation-phase-2",
        excerpt:
          "Following up on the donation receipts — is there an update I can share with our finance team?",
      },
      {
        source: "slack" as const,
        slug: "annual-newsletter",
        excerpt:
          "When you have a sec, can we sync on the next newsletter date? It's been a while.",
      },
    ];

    for (const sample of samples) {
      if (!allow(sample.source)) continue;
      const minutesAgo = 30 + Math.floor(rng() * 8 * 60);
      const partnerKey =
        seedPartners[Math.floor(rng() * seedPartners.length)] ?? "default";
      const externals =
        EXTERNAL_PEOPLE_BY_PARTNER[partnerKey] ??
        EXTERNAL_PEOPLE_BY_PARTNER.default!;
      const actor = pickN(rng, externals, 1)[0]!;
      out.push({
        id: `ping:${sample.source}:${sample.slug}:${minutesAgo}`,
        source: sample.source,
        timestamp: new Date(now - minutesAgo * 60_000).toISOString(),
        from: {
          name: actor.name,
          handle: actor.handle,
          is_external: true,
        },
        excerpt: sample.excerpt,
        project_match: {
          project_slug: sample.slug,
          matched_by:
            sample.source === "slack"
              ? "slack_channel"
              : sample.source === "p2"
                ? "p2_url"
                : "zendesk_ticket",
        },
        is_mock: true,
      });
    }

    out.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    return out.slice(0, limit);
  }
}

function shortHash(rng: () => number): string {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 7; i += 1) {
    out += chars.charAt(Math.floor(rng() * chars.length));
  }
  return out;
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}
