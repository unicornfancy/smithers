# Project metadata — frontmatter contract for `info.md`

Every project in Smithers — whether sourced from Hive Mind (`partner` kind) or the local vault (`team` / `personal` kinds) — has an `info.md` file whose YAML frontmatter follows a single contract. This is the schema the workbench reads to render quick links, milestones, panels, and badges.

## Schema

```yaml
---
# Identity
project_id: "uuid"                    # stable across kind changes; required
slug: "kebab-case-slug"               # required
name: "Human-readable name"           # required
kind: partner | team | personal       # required
partner: "partner-slug"               # required iff kind=partner; optional for kind=team or personal
status: research | planning | active | hot | secondary | cold | at-risk | launched | archived

# Quick links (all optional; render in the header pill row when present)
github_repo: "owner/repo"
staging_url: "https://staging.example.com"
production_url: "https://www.example.com"
linear_project_id: "lin_123"
linear_project_slug: "team51/project"
zendesk_org: "org-slug"
p2_url: "https://team51.wordpress.com/?p=12345"

# Slack channels (used by ping matcher)
primary_slack_channel: "#partner-name"
team_slack_channel: "#team51-internal"

# Files relative to project folder
agenda_file: "agenda.md"

# Cadence and special handling
next_nudge: "2026-09-15"              # optional; for cold projects with seasonal touchpoints
review_interval_days: 30              # optional override; default 30
nda: true                             # if true, partner notes panel hidden in screenshots/exports

# Tags / search
tags: ["tag1", "tag2"]
---
```

## Required vs optional

| Field | Required | Notes |
|---|---|---|
| `project_id` | yes | UUID, never change |
| `slug` | yes | matches folder name |
| `name` | yes | shown in title bar |
| `kind` | yes | drives layout |
| `status` | yes | drives stall engine |
| `partner` | iff `kind=partner` | Hive Mind partner slug |
| everything else | no | renders panels/quick-links when present |

## Storage by kind

- **`kind: partner`** → `~/Team51-Hive-Mind/knowledge/partners/<partner>/projects/<slug>/info.md`
- **`kind: team`** → `<vault>/Projects/<slug>/info.md` with `kind: team`
- **`kind: personal`** → `<vault>/Projects/<slug>/info.md` with `kind: personal`

Smithers' `packages/vault` and `packages/mcp-client/hive-mind` produce a unified `Project[]` regardless of source.

## Migration notes

- The Hive Mind `info.md` schema currently has a smaller set. We're adding `project_id`, `staging_url`, `production_url`, `primary_slack_channel`, `team_slack_channel`, `agenda_file`, and `next_nudge` upstream. PR planned.
- Until the upstream PR lands, Smithers reads what's there and tolerates missing fields.
