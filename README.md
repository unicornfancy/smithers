# Smithers

> _A loyal, slightly fussy butler for your work._

Smithers is a project-centric personal-assistant workbench that runs locally on your machine. It pulls together everything that lives in different tools — your vault notes, partner knowledge, GitHub repos, Linear designs, P2 threads, Slack conversations, Zendesk escalations, call transcripts — and surfaces them as **per-project workbenches** with AI-assisted drafting, follow-up tracking, agendas, weekly updates, and a derived `/today` dashboard.

It is the successor to a notes-folder-plus-cron-jobs setup. The vault stays as the source of truth, but you no longer live inside it.

## Status

🚧 **Pre-alpha.** Currently scaffolding. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design and the tracked plan in `~/.cursor/plans/smithers_*.plan.md` for the full build map.

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
   │  + chokidar       │       │ Hive Mind · Fathom│
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

## Quick start

```bash
# clone
git clone https://github.com/unicornfancy/smithers.git ~/smithers
cd ~/smithers

# install
pnpm install

# run the first-time setup wizard (configures vault path, MCPs, transcription, etc.)
pnpm dev
# → open http://localhost:3000/setup
```

The wizard will:

1. Detect or create your vault.
2. Detect a sibling [Team51-Hive-Mind](https://github.com/a8cteam51/Team51-Hive-Mind) clone (skippable).
3. Configure your transcription provider.
4. Test live-data MCP connections (skippable — degraded mode works).
5. Run an initial sync.
6. Drop you on `/today`.

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

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design and component boundaries
- [`docs/PHASE6.md`](docs/PHASE6.md) — context assembly model
- [`docs/HIVE-MIND.md`](docs/HIVE-MIND.md) — how Smithers consumes Team51-Hive-Mind
- [`docs/SKILLS.md`](docs/SKILLS.md) — using and contributing skills
- [`docs/PROJECT-METADATA.md`](docs/PROJECT-METADATA.md) — frontmatter contract for `info.md`
- [`docs/TRANSCRIPTION-ADAPTERS.md`](docs/TRANSCRIPTION-ADAPTERS.md) — adapter interface
- [`docs/MIGRATION.md`](docs/MIGRATION.md) — migrating from a notes-folder + cron setup

## License

MIT — see [`LICENSE`](LICENSE).
