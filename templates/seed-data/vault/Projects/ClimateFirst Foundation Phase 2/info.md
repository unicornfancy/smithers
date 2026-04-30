---
project_id: 11111111-1111-4111-8111-111111111111
slug: climatefirst-foundation-phase-2
name: ClimateFirst Foundation Phase 2
kind: partner
partner: climatefirst-foundation
status: active
github_repo: a8cteam51/climatefirst-foundation
linear_project_slug: team51/climatefirst-phase-2
zendesk_tickets:
  - "11134851"
  - "https://automattic.zendesk.com/agent/tickets/12000123"
p2_url: https://team51.wordpress.com/?p=99001
primary_slack_channel: "#climatefirst-foundation"
team_slack_channel: "#team51-internal"
nda: false
tags: ["nonprofit", "active-launch"]
---

# ClimateFirst Foundation — Phase 2

Headless WordPress + WPGraphQL build for the Foundation's research portal. Phase 2 adds AI-search over their published library and a vetted document import workflow.

## Phase 2 scope

- Document ingestion pipeline (DOI lookup → S3 → approval queue → published)
- AI search over indexed publications (only vetted docs are searchable)
- Editorial dashboard for the comms team

## Open questions

- Confirm hosting plan with WordPress.com VIP for production cutover
- Decide on rate-limiting strategy for the public AI-search endpoint
