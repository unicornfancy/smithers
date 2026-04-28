# Phase 6 — Context Assembly

> _Pings arrive with everything you need to act on them already gathered._

This is the core architectural commitment of Smithers, not a feature shipped late. Every inbound surface (Slack mention, P2 reply, Zendesk escalation, Fathom transcript with action items) is rendered alongside the relevant project context: P2 thread, GitHub issue, Linear design, recent Slack messages in that channel, partner Hive Mind profile, open follow-ups.

## How it works

1. An inbound event lands in SQLite via the ping-monitor or Fathom-sync job.
2. The matcher tries to attribute it to a project by:
   - Slack channel → `partner_slack_channel` or `team_slack_channel` in project frontmatter
   - GitHub repo → `github_repo` field
   - Linear project → `linear_project_id` or `linear_project_slug`
   - Zendesk org → `zendesk_org`
   - P2 post URL → `p2_url` or weekly-update finder
   - Email domain (Fathom attendees) → `internal_email_domains` (excludes) or partner profile match
3. If matched, the project's full context bundle is pre-fetched and cached.
4. The /today and /projects pages render the ping with a “context strip” showing the matched project's quick links + recent activity + open follow-ups.

## Why this is the architecture, not a feature

The traditional path is: see ping → open project → gather context → respond. Smithers collapses that to: see ping (with context already assembled) → respond.

Doing this as a feature added later means every list view, every detail view, every search result has to be retrofit to carry context. Doing it as architecture means every read of an inbound event composes the context bundle as a first-class step. UI components like the ping list are then thin renderers over a Pre-Assembled type.

## Type sketch

```ts
type AssembledPing = {
  ping_id: string;
  source: "slack" | "p2" | "zendesk" | "fathom-action-item" | "email";
  raw: SourceSpecificPayload;
  matched_project?: Project;
  context: {
    quick_links: ProjectQuickLink[];   // P2, GitHub, Linear, Zendesk, Slack
    recent_activity: ActivityEvent[];  // last 7d across sources
    open_follow_ups: FollowUp[];
    open_drafts: Draft[];
    partner_profile?: PartnerSummary;  // partner-kind only
    last_call_summary?: CallSummary;
  };
  suggested_actions: Action[];         // AI-generated, ghost-button surfaced
};
```

## Failure modes

- **No project match** → render with a “Match to project…” affordance and a free-text search. User decision is recorded; matcher learns from accepted matches.
- **MCP source down** → context bundle renders with the available sources and a small badge per missing source ("Slack data Xh stale").
- **Ambiguous match** (multiple candidates) → top-2 candidates surfaced with a one-click pick.
