# Smithers

> _A loyal, slightly fussy butler for your work._

Smithers is a workbench that pulls together everything a Launch TAM juggles — your notes, partner data from the Hive Mind, Slack threads, GitHub repos, Linear designs, Zendesk tickets, Fathom call transcripts, Google Drive folders — into one project-by-project view. It runs on your laptop. Markdown files are the source of truth, so nothing's locked up in a proprietary database.

**New here?** Skip to [Getting started](#getting-started). The walkthrough in [ONBOARDING.md](ONBOARDING.md) explains every step in detail with what to expect at each one. If something breaks, [TROUBLESHOOTING.md](TROUBLESHOOTING.md) has the diagnostic recipes.

## Is this for me?

Smithers is built for **Automattic Team51 Launch TAMs**. It's most useful if some of these sound familiar:

- You bounce between Hive Mind, GitHub, Linear, Slack, and Zendesk all day and lose track of where a thread last was.
- You take meeting notes in Fathom and want them auto-attached to the right project.
- You want AI help drafting partner emails / P2 updates / weekly summaries, but you don't want anything sent automatically — every message gets a final review.
- You'd rather work from plain-text markdown files than a closed app you can't export from.

You don't need to be technical to use it day-to-day. You do need to spend ~30 minutes on first-time setup (cloning the repo, installing a couple of tools). The walkthrough holds your hand.

## What you get

- **Per-project workbenches** — one page per partner / team / personal project, with live activity feed, open items, follow-ups, agendas, AI-drafted messages, processed calls, QA reports, and Drive activity all in one place.
- **`/today` dashboard** — your daily landing page: hot pings, follow-ups waiting, recently-recorded calls, AI-picked "top 3 things to act on today."
- **AI-assisted drafting** — draft Zendesk replies, P2 updates, weekly partner check-ins, call recaps, and brief documents in your own voice. Nothing sends until you click Send.
- **Personal Digest** (`/digest`) — a weekly highlight tracker with an AI suggestion engine that mines your week for accomplishments worth remembering.
- **Kosh QA reports** (`/projects/<slug>/qa`) — kick off functional / performance / accessibility audits against a partner's staging URL and archive the reports in Hive Mind. Convert findings into GitHub issues with one click.
- **Ask Smithers palette** (`Cmd+K`) — natural-language navigation: "where's the brief for Body Dao", "show me drafts in flight", "draft a nudge for the Pocket NYC partner".

## Getting started

The full step-by-step walkthrough lives in [ONBOARDING.md](ONBOARDING.md) — read that if any of the steps below feel jargon-y. The summary version:

### What you'll need before you start

- A Mac (Smithers also runs on Linux; Windows isn't supported yet).
- A free **Anthropic Claude Enterprise** API key — follow the steps in the [Field Guide](https://fieldguide.automattic.com/claude-enterprise/#enterprise-uses-sso-not-api-keys).
- Optional but strongly recommended: a local copy of [Team51-Hive-Mind](https://github.com/a8cteam51/Team51-Hive-Mind) on disk. Smithers can run without it (you'll see placeholder partner data), but you'll get the full experience with it.
- Optional: a [Linear personal API key](https://linear.app/settings/api), and Google Cloud credentials for Drive activity tracking (covered in ONBOARDING).

### The five-minute version

```bash
# 1. Open the Terminal app (Cmd+Space, type "terminal", press Enter)

# 2. Install Node.js and pnpm (the runtime + package manager Smithers uses)
brew install node pnpm                # if you don't have Homebrew, see ONBOARDING

# 3. Clone Smithers into your home folder
git clone https://github.com/unicornfancy/smithers.git ~/smithers
cd ~/smithers

# 4. Install Smithers' dependencies (takes a minute)
pnpm install

# 5. Start the dev server
pnpm dev
```

Then open **http://localhost:3000/setup** in your browser. You'll see a wizard that walks you through the rest: pointing at your notes folder, pasting your Anthropic key, connecting Hive Mind, etc. The wizard is designed to be self-explanatory.

**After saving anything in the wizard, you have to restart `pnpm dev`** (press `Ctrl+C` to stop, then `pnpm dev` again). Smithers loads config once at startup — the restart picks up your changes.

That's enough to get you onto the `/today` dashboard. Stuck? Open [ONBOARDING.md](ONBOARDING.md) — every step is broken down further with "what success looks like" and "if you see this error" notes.

## What's different from just a notes folder

- **Project pages are the surface.** Each project has a workbench page showing live activity, open items, drafts in flight, follow-ups, call notes, and (for partner projects) Hive Mind partner info. The daily note becomes a derived dashboard, not the front door.
- **Three project kinds, one rendering.** `partner` (sourced from Team51-Hive-Mind), `team` (internal initiatives), `personal` (individual projects). One UI, three sources.
- **AI lives where the work happens.** Ghost-button assists for drafting and analysis. Nothing auto-posts; everything goes through a draft review.
- **Vault stays Obsidian-compatible.** Smithers reads and writes plain markdown with YAML frontmatter. Keep using Obsidian alongside it, drop Obsidian entirely, or start fresh from templates — your call.

## Documentation

| Doc | When you need it |
|---|---|
| [ONBOARDING.md](ONBOARDING.md) | First-time setup — step by step, with screenshots-worth of detail |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | "Something's not working, what do I check?" |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit together (technical) |
| [docs/HIVE-MIND.md](docs/HIVE-MIND.md) | What Smithers reads vs. writes to your Hive Mind clone |
| [docs/PROJECT-METADATA.md](docs/PROJECT-METADATA.md) | The frontmatter fields each project file supports |
| [docs/SKILLS.md](docs/SKILLS.md) | Using and writing Hive Mind skills from Smithers |
| [docs/TRANSCRIPTION-ADAPTERS.md](docs/TRANSCRIPTION-ADAPTERS.md) | Swapping Fathom for Granola / Whisper / Gemini |
| [CLAUDE.md](CLAUDE.md) | Guidance for AI coding agents working in this repo |

## Architecture (technical)

```
┌─────────────────────────────────────────────────────────────┐
│  apps/web  (Next.js 15 · App Router · RSC · Tailwind v4)    │
│  /today  /projects/[slug]  /drafts  /agendas  /follow-ups   │
│  /weekly-updates  /digest  /style-guide  /settings          │
└────────────┬───────────────────────────┬────────────────────┘
             │                           │
   ┌─────────▼─────────┐       ┌─────────▼─────────┐
   │  packages/vault   │       │ packages/         │
   │  read/write MD    │       │   mcp-client      │
   │  + frontmatter    │       │ ContextA8C ·      │
   │  + atomic writes  │       │ Hive Mind · Fathom│
   └─────────┬─────────┘       │ · Google Drive    │
             │                 └─────────┬─────────┘
             └───────┬───────────────────┘
                     │
          ┌──────────▼──────────┐
          │  packages/agents    │
          │  prompt runners +   │
          │  Claude/Anthropic   │
          └─────────────────────┘
```

Plus `packages/transcription` (pluggable adapter pattern: Fathom · Granola · Manual; Whisper/Gemini stubs) and `packages/ui` (shared shadcn/ui components).

## Repo layout

```
smithers/
├── apps/web/                Next.js app (the workbench UI)
├── packages/
│   ├── vault/               markdown + frontmatter read/write
│   ├── mcp-client/          typed wrappers: ContextA8C / Hive Mind / Fathom / Drive
│   ├── agents/              prompt templates + Claude/Anthropic runner
│   ├── transcription/       pluggable transcription adapters
│   └── ui/                  shared shadcn/ui components
├── templates/vault/         starter vault layout for new installs
├── docs/                    architecture, integration, migration guides
└── scripts/                 one-off jobs and the `pnpm jobs:run-once` runner
```

## License

MIT — see [LICENSE](LICENSE).
