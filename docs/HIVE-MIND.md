# Hive Mind integration

Smithers consumes [Team51-Hive-Mind](https://github.com/a8cteam51/Team51-Hive-Mind) as a sibling clone — typically `~/Team51-Hive-Mind/` next to `~/smithers/`. It uses the Hive Mind both as a local git repo (read-mostly) and through the Hive Mind MCP server for richer querying.

## What we read

- `knowledge/partners/<partner>/info.md` — partner profile (frontmatter + body) → drives the **Partner Info** panel on partner-kind project pages.
- `knowledge/partners/<partner>/projects/<slug>/info.md` — per-project frontmatter contract (see [`PROJECT-METADATA.md`](PROJECT-METADATA.md)) drives the workbench layout (Quick Links, Status, Milestones).
- `knowledge/partners/<partner>/projects/<slug>/deadlines.md` — drives the **Milestones** band (when present).
- `knowledge/partners/<partner>/projects/<slug>/notes.md` — drives the **Partner Notes** panel.
- `.claude/skills/` — local copies of skills are mirrored into Smithers' `.claude/skills/` for use by `packages/agents`.

## What we write

Smithers writes to Hive Mind only through an explicit `/save` flow:

1. User makes changes in a partner-kind project page.
2. Changes accumulate in a per-session pending changeset (visible as a "pending partner changes (3)" indicator in the header).
3. User clicks `Save to Hive Mind` → review modal shows diff → on confirm, Smithers makes a single batched git commit on a working branch.
4. Branch can be pushed and turned into a PR upstream — never silently merged to main.

## Personal vs partner notes

- The **Partner Notes** panel writes to Hive Mind (`knowledge/partners/<partner>/projects/<slug>/notes.md`). Anyone with the clone can see it.
- The **Personal Notes** panel writes to the local vault (`Projects/<slug>/notes.md`). Stays on your machine.

## Project kind transitions

- **team / personal → partner**: optional partner field, file-copy + Hive Mind commit. Research-stage projects without a partner sit in `_unaffiliated/` until assigned.
- **partner → team / personal**: ALWAYS via PR workflow. Never silent local-only.
- **team ↔ personal**: instant frontmatter flip.

Stable `project_id` UUID survives all transitions.

## Skills

Skills live in `~/Team51-Hive-Mind/.claude/skills/`. Smithers reads them there directly when using `packages/agents`. Personal skill drafts that haven't been contributed yet sit in `~/smithers/.claude/skills/` and override Hive Mind ones with the same name.

To contribute a personal skill back, the **Promote to Hive Mind** action opens a PR against `Team51-Hive-Mind` with the skill folder.

## MCP server

[`Team51-Hive-Mind/mcp/server`](https://github.com/a8cteam51/Team51-Hive-Mind/tree/main/mcp/server) exposes `search-knowledge`, `get-partner`, `list-partners`, `get-project`. We call it via `packages/mcp-client/hive-mind` for richer queries that go beyond simple file reads.
