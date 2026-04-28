# CLAUDE.md — Working on Smithers

This file orients AI agents (Claude Code, Cursor, Codex) working in this repo. Keep it short, current, and scannable.

## What this repo is

Smithers is a local web application: a project-centric personal-assistant workbench. The UI is a Next.js 15 App Router app in `apps/web/`. Domain logic lives in `packages/*`. Background work happens via standalone Node scripts under `scripts/` (run by macOS launchd in production; `pnpm jobs:run-once <name>` for ad-hoc).

## Critical rules

1. **Never touch the user's vault outside the documented vault helpers.** All vault reads/writes go through `@smithers/vault`. Treat the vault as user-owned data — file moves, deletes, and renames need user-visible audit trails.
2. **Never auto-post anywhere.** Posting to P2, sending follow-ups, or committing to Hive Mind always goes through a confirmation modal.
3. **Markdown is the source of truth.** SQLite is cache + UI state only. If SQLite and the vault disagree, the vault wins; reconcile and update SQLite.
4. **Stable identity wins over file paths.** Drafts, call notes, and weekly updates carry UUIDs in frontmatter. Don't track them by path.
5. **Hive Mind is read-mostly.** Personal notes go to the local vault. Partner-shared notes go to Hive Mind via `/save` flow with batched commits and explicit user confirmation.
6. **All AI writes are reviewable.** Inline AI affordances are ghost buttons that produce drafts; users approve before anything mutates.

## Where things live

- `apps/web/app/` — pages (App Router, mostly RSC; client components only when needed)
- `apps/web/components/` — UI components (shadcn/ui in `components/ui/`)
- `apps/web/lib/` — app-level utilities, server actions
- `packages/vault/` — markdown read/write, frontmatter parse, chokidar watcher
- `packages/mcp-client/` — typed wrappers for ContextA8C, Hive Mind MCP, Fathom MCP
- `packages/agents/` — prompt templates + Claude/Anthropic runner; one folder per agent
- `packages/transcription/` — adapter pattern (Fathom / Granola / Manual / Whisper-stub / Gemini-stub)
- `packages/ui/` — shared shadcn/ui components used across apps
- `prompts/` — long-form prompt templates referenced by `packages/agents`
- `templates/vault/` — starter vault templates (Daily Note, Weekly Update, etc.)
- `templates/seed-data/` — NDA-safe demo content for screenshots / mock-mode
- `scripts/` — standalone Node scripts for launchd-scheduled jobs
- `docs/` — architecture, integration, migration

## Conventions

- TypeScript everywhere. Strict mode. `verbatimModuleSyntax` on. No `any` without a comment explaining why.
- Server-first: prefer Server Components and Server Actions. Client components only for interactivity.
- Tailwind v4 + shadcn/ui (new-york style, zinc base). Dark mode via `next-themes` class strategy.
- File naming: kebab-case for files, PascalCase for components, camelCase for variables.
- No barrel `index.ts` re-exports unless the package boundary requires them.
- Comments explain _why_, not _what_. Don't narrate the code.

## Commit style

Conventional-ish, short, descriptive:

- `feat(workbench): add Live Activity feed source filters`
- `fix(vault): handle frontmatter with empty string values`
- `chore(deps): bump shadcn components`

Incremental commits per todo or logical chunk. Don't squash a day's worth of work into one commit.

## Pause points (don't skip)

Before any of these, stop and surface to the user:

1. Pushing the repo to `github.com/unicornfancy/smithers`.
2. Opening a PR upstream against `Team51-Hive-Mind`.
3. Cutover steps that disable the user's existing notes-folder + cron jobs.
4. The first vault writes against a `partner`-kind project.

## Linked context

- Team51-Hive-Mind: `~/Team51-Hive-Mind/` (sibling clone)
- Existing notes vault: `~/Documents/A8C Claude/` (read while migrating; left untouched until cutover)
- Plan file: `~/.cursor/plans/smithers_*.plan.md`
