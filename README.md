# Smithers

> _A loyal, slightly fussy butler for your work._

Smithers is a project-centric personal-assistant workbench for **Automattic Team51 Launch TAMs**. It runs locally on your machine and pulls together everything that lives in different tools — your vault notes, partner knowledge from [Team51-Hive-Mind](https://github.com/a8cteam51/Team51-Hive-Mind), GitHub repos, Linear designs, P2 threads, Slack conversations, Zendesk escalations, call transcripts — and surfaces them as **per-project workbenches** with AI-assisted drafting, follow-up tracking, agendas, weekly updates, and a derived `/today` dashboard.

Markdown is the source of truth. SQLite at `~/.smithers/state.db` is cache + UI state only.

New to Smithers? Start with [**ONBOARDING.md**](ONBOARDING.md) for the first-time walkthrough. When something breaks, [**TROUBLESHOOTING.md**](TROUBLESHOOTING.md) has the diagnostic commands.

## What's different from a notes folder

- **Project pages are the surface.** Each project has a workbench page that shows live activity, open items, drafts in flight, follow-ups, call notes, and (for partner projects) Hive Mind partner info. The daily note becomes a derived dashboard, not the front door.
- **Phase 6 context assembly is the architecture, not a feature.** When a ping comes in, Smithers pre-assembles the relevant project links — P2 thread, GitHub issue, Linear design, recent Slack messages, Zendesk ticket — next to the inbound message.
- **Three project kinds, unified rendering.** `partner` (sourced from [Team51-Hive-Mind](https://github.com/a8cteam51/Team51-Hive-Mind)), `team` (internal initiatives in your vault), and `personal` (individual projects in your vault). One UI, three sources.
- **AI lives where the work happens.** Inline ghost-button assists for drafting, summarizing threads, suggesting next steps, and composing nudges. No silent mutations; all writes go through review gates.
- **Vault stays Obsidian-compatible, not Obsidian-required.** Smithers reads and writes plain markdown with frontmatter. You can keep using Obsidian alongside it, drop Obsidian entirely, or start fresh from templates.

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────────┐
│  apps/web  (Next.js 15 · App Router · RSC · Tailwind v4)    │
│  /today  /projects/[slug]  /drafts  /agendas  /follow-ups   │
│  /weekly-updates  /style-guide  /settings  /setup           │
└────────────┬───────────────────────────┬────────────────────┘
             │                           │
   ┌─────────▼─────────┐       ┌─────────▼─────────┐
   │  packages/vault   │       │ packages/         │
   │  read/write MD    │       │   mcp-client      │
   │  + frontmatter    │       │ ContextA8C ·      │
   │  + atomic writes  │       │ Hive Mind · Fathom│
   └─────────┬─────────┘       └─────────┬─────────┘
             │                           │
             └───────┬───────────────────┘
                     │
          ┌──────────▼──────────┐
          │  packages/agents    │
          │  prompt runners +   │
          │  Claude/Anthropic   │
          └─────────────────────┘
```

Plus `packages/transcription` (pluggable adapter pattern: Fathom · Granola · Manual paste; Whisper/Gemini stubs) and `packages/ui` (shared shadcn/ui components).

## Prereqs

- macOS or Linux (paths assume `~/` Unix semantics).
- **Node 20+** (`node --version` — the repo's `engines` enforces this).
- **pnpm 9+** (`pnpm --version` — install with `npm install -g pnpm` or `corepack enable`).
- An **Anthropic API key** (`sk-ant-…`) for the AI affordances.
- Optional but recommended: a local clone of [`a8cteam51/Team51-Hive-Mind`](https://github.com/a8cteam51/Team51-Hive-Mind) for partner data. Smithers runs without it (mock mode), but partner workbenches need it for real data.
- Optional: a Linear API key for direct Linear writes (project status, sub-tasks).

## Quick start

```bash
# clone
git clone https://github.com/unicornfancy/smithers.git ~/smithers
cd ~/smithers

# install
pnpm install

# start the dev server
pnpm dev
# → open http://localhost:3000/setup
```

The `/setup` wizard configures three things:

1. **Paths** — vault (your markdown notes folder), Hive Mind clone, my-voice skill files.
2. **API keys** — `ANTHROPIC_API_KEY` (required) and `LINEAR_API_KEY` (optional). Both write to `apps/web/.env.local`.
3. **MCP toggles** — turn ContextA8C / Hive Mind / Fathom on once you've set the corresponding path. Any MCP that's off falls back to mock data, so the UI keeps working while you finish setup.

After saving any field, **restart `pnpm dev`** — Next.js reads config and env vars once at boot. Then visit `/today` for the daily dashboard.

### Don't have a vault yet?

Totally fine — Smithers doesn't require an existing Obsidian vault. Make an empty folder anywhere, point the wizard at it, and you're done:

```bash
mkdir -p ~/Smithers-Vault
# then in the /setup wizard: Paths → Vault → ~/Smithers-Vault → Save
```

Smithers creates the subfolders it needs (`Projects/`, `Daily Notes/`, `Drafts/`, `Call Notes/`, `Agendas/`, `Weekly Updates/`, `Follow-ups.md`) on first write — you don't need to scaffold them upfront. The expected shape is documented in [`templates/vault/README.md`](templates/vault/README.md) if you want to mirror it by hand.

Add your first project once the wizard is green:

- **`/projects/onboard`** — joins your Linear projects, Hive Mind partners, and any existing vault scratchpads into one table with per-row Import / Connect / Set up actions. The right entry point if you already have partners in Hive Mind.
- **`/projects/new`** — minimal form to create a vault-only project (team or personal). Use this for internal initiatives that don't have a Hive Mind partner.

The full walkthrough lives in [`ONBOARDING.md`](ONBOARDING.md), including expected output at each step and the most common errors.

## Repo layout

```
smithers/
├── apps/
│   └── web/                  Next.js app (the workbench UI)
├── packages/
│   ├── vault/                markdown + frontmatter read/write helpers
│   ├── mcp-client/           typed wrappers for ContextA8C / Hive Mind / Fathom
│   ├── agents/               prompt templates + Claude/Anthropic runner
│   ├── transcription/        pluggable transcription provider adapters
│   └── ui/                   shared shadcn/ui components
├── prompts/                  prompt templates (briefing, top-3, drafts, etc.)
├── templates/
│   ├── vault/                starter vault templates (Daily Note, Weekly Update, etc.)
│   └── seed-data/            NDA-safe demo data for screenshots / mock mode
├── docs/                     architecture, integration, migration guides
├── scripts/                  one-off jobs and the `pnpm jobs:run-once` runner
└── .claude/skills/           local copies of Hive Mind skills (consumed)
```

## Documentation

- [`ONBOARDING.md`](ONBOARDING.md) — first-time setup walkthrough for a new TAM
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — "Smithers is acting weird, what do I run?"
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design and component boundaries
- [`docs/PHASE6.md`](docs/PHASE6.md) — context assembly model
- [`docs/HIVE-MIND.md`](docs/HIVE-MIND.md) — how Smithers consumes Team51-Hive-Mind
- [`docs/SKILLS.md`](docs/SKILLS.md) — using and contributing skills
- [`docs/PROJECT-METADATA.md`](docs/PROJECT-METADATA.md) — frontmatter contract for `info.md`
- [`docs/TRANSCRIPTION-ADAPTERS.md`](docs/TRANSCRIPTION-ADAPTERS.md) — adapter interface
- [`docs/MIGRATION.md`](docs/MIGRATION.md) — migrating from a notes-folder + cron setup

## License

MIT — see [`LICENSE`](LICENSE).
