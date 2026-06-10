# Smithers — Overview

> **Draft.** First pass for the wider-audience release. Edit freely — sections
> marked with `[TODO]` are placeholders where you may want to drop in your own
> framing, screenshots, or examples.

## What it is

Smithers is a personal-assistant workbench for a TAM. It runs locally as a
Next.js app, reads your existing Obsidian-compatible markdown vault, and pulls
in live data from the tools you already use — Hive Mind, Linear, GitHub,
Slack, Zendesk, P2, Fathom / Granola call transcripts — so everything that
matters about a project sits on one page.

It is **not** a notes app, a CRM, or a chatbot. It's a workbench: a
project-centric surface that turns scattered context into a daily-actionable
view, plus a small set of AI affordances that draft outbound work for you to
review.

[TODO: drop in your own one-liner / hype paragraph here for the audience you're
sharing this with]

## Mental model

Three ideas do most of the work:

1. **Markdown is the source of truth.** Project files, follow-ups, agendas,
   drafts, weekly updates, call notes — all plain markdown with YAML
   frontmatter. SQLite at `~/.smithers/state.db` is cache + UI state only.
   You can keep using Obsidian alongside Smithers, or drop Obsidian entirely.
2. **The project is the unit.** Every surface is project-centric: a workbench
   page per project assembles status, open items, follow-ups, recent calls,
   threads, drafts, and partner knowledge. `/today` is a derived dashboard
   that pulls from project state, not the other way around.
3. **Live data comes through MCP.** ContextA8C (Slack / Linear / GitHub /
   Zendesk / P2 / mgs), Hive Mind (the team's shared partner knowledge
   repo), and the configured transcription provider all sit behind typed
   MCP clients. Anything that's unconfigured falls back to mock data, so the
   UI keeps working while you finish setup.

Three project kinds, one rendering:

- **partner** — sourced from
  [Team51-Hive-Mind](https://github.com/a8cteam51/Team51-Hive-Mind) plus a
  vault scratchpad for your personal tracking.
- **team** — internal initiatives that live entirely in your vault.
- **personal** — individual projects that live entirely in your vault.

## The daily flow

A typical day looks like this:

1. **Open `/today`.** Top 3 picks, Realistic Shape, Hot Pings (Slack / Linear
   / Zendesk / GitHub), Stalls, Recent Calls. Half the surfaces are scored
   automatically; the rest is what the AI thinks you should think about
   first.
2. **Click into a project.** Each workbench has Now / Comms / Knowledge /
   Drafts tabs (optional — single-page mode is also available). Open Items,
   follow-ups, Zendesk threads, recent calls, the project log, partner
   info — all the context for that project on one page.
3. **Use the inline affordances.** Draft a Zendesk reply, compose a follow-up
   nudge, summarize a long Zendesk thread, draft a P2 update from a call
   transcript, run a Hive Mind skill (`/create-brief`, `/project-handoff`).
   Every AI output is a draft you review and save — nothing posts on your
   behalf.
4. **Process new calls.** When a Fathom / Granola call lands, click Process
   Call on the recording. Smithers fetches the transcript, runs analysis,
   and offers action items, decisions, and follow-ups for you to accept
   into the right surfaces.
5. **End the week with a weekly update.** `/weekly-updates` pre-computes
   per-project facts (your outbound Zendesk replies, open tasks, Linear
   updates, calls, drafts) and drafts the team-P2 post for you to edit and
   copy.

## Surfaces (tour)

A quick read-this-to-know-what's-there reference for the routes:

| Route | What it is |
|---|---|
| `/today` | Daily dashboard. Top 3, hot pings, recent calls, stalls. |
| `/projects` | Sortable / filterable index of all projects. |
| `/projects/[slug]` | The workbench. Tabs or single page; this is where the work happens. |
| `/calls` | All recent Fathom / Granola recordings, matched to projects (with manual override). |
| `/drafts` | Saved drafts (Zendesk replies, follow-up nudges, P2 posts). |
| `/agendas` | Per-partner agendas, editable inline. |
| `/follow-ups` | The full follow-ups table (active + resolved). |
| `/weekly-updates` | Monday weekly update drafting + history. |
| `/partner-knowledge/[slug]` | In-app editor for partner-knowledge.md (body + contacts). |
| `/style-guide` | Voice + style files Smithers feeds to every drafting agent. |
| `/settings` | All tunable knobs in one tabbed page (Workflow / Setup / Diagnostics / Skills / About). |
| `/setup` | First-run wizard — paths, identity, API keys, MCP toggles. |
| Cmd-K | Ask Smithers palette: search projects / follow-ups / pages, take structured actions (Add task, Set status, Resolve follow-up…), or ask in natural language. |

[TODO: maybe drop in 2-3 screenshots here — `/today`, a project workbench, the
Cmd-K palette mid-action]

## AI affordances

Two patterns underpin everything:

1. **Draft, never send.** Every outbound surface (Zendesk reply, follow-up
   nudge, P2 update, weekly update, project brief) produces a draft for you
   to review. Saves go to the vault. Posting is always a manual copy-paste
   for now — no auto-send.
2. **Voice first.** Drafting agents read your `my-voice/` files (`SKILL.md`,
   `PARTNER_COMMS.md`, `INTERNAL_STYLE_GUIDE.md`, `EXTERNAL_STYLE_GUIDE.md`,
   `REPORT_STRUCTURE.md`, `WEEKLY_UPDATE_STYLE.md`, `JOB_CONTEXT.md`) so
   drafts match how you actually write. When you edit a draft, the
   learn-from-archives loop appends the patterns it learned back to those
   files automatically.

What's available (non-exhaustive):

- **Top 3** — picks the 1–3 most consequential things for today across all
  projects.
- **Realistic Shape** — narrates what your day is actually going to feel
  like ("light morning, busy afternoon, one meeting").
- **Suggest Next Step** — per-project: "what should I do on this project
  right now?"
- **Draft Zendesk reply** — with optional partner-context pinning.
- **Compose follow-up nudge** — when a follow-up crosses the escalate
  threshold.
- **Process Call** — extracts action items, decisions, follow-ups from a
  call transcript.
- **Summarize Zendesk thread** — collapses a long thread to a one-paragraph
  status.
- **Compose weekly update** — drafts your Monday team-P2 post from the
  week's facts.
- **Hive Mind skills** — `/create-brief`, `/project-handoff`,
  `/search-knowledge`, `/update-knowledge` run as native wizards.
- **Ask Smithers (Cmd-K)** — palette that takes structured actions on
  projects + follow-ups, or runs a free-form query through a small
  dispatcher agent that confirms before writing.

[TODO: link to a one-page "AI affordances by surface" matrix if you want
something denser]

## What you configure once

`/setup` walks you through the essentials:

- **Paths** — vault (your markdown notes folder), Hive Mind clone, my-voice
  skill files.
- **Identity** — your name, email, GitHub handle, Slack handle. Drives
  filters ("drop my own self-posts from the ping feed"), signature parsing
  ("did Katie reply to this Zendesk thread?"), and quick-link defaults.
- **API keys** — `ANTHROPIC_API_KEY` (required for any AI affordance),
  `LINEAR_API_KEY` (optional but lights up direct Linear writes),
  `GRANOLA_API_KEY` (only if you switch transcription provider).
- **MCP toggles** — turn ContextA8C / Hive Mind / Fathom on once the
  corresponding path / auth is set. Each MCP independently falls back to
  mock if disabled.

After saving any field, **restart `pnpm dev`** — Next.js reads config and env
vars once at boot.

## What runs in the background

Configurable from `/settings → Workflow`. All defaults off until you opt in.

- **Daily briefing** — fires at a configured HH:MM each day. Pre-warms Top 3
  + Realistic Shape + writes a snippet to today's daily note.
- **Ping monitor** — re-checks every Pings-to-Action item so the feed auto-
  hides items you've already replied to.
- **Transcription sync** — warms the configured provider's recordings cache
  so `/calls` and Recent Calls show new meetings without an explicit fetch.
- **Hive Mind sync** — `git pull` (with rebase + push for local-ahead
  commits) on the Hive Mind clone so other TAMs' edits land automatically.
- **Team roster sync** — refreshes the Matticspace-sourced collaborator
  block in `JOB_CONTEXT.md` so the AI knows who's on the team.

Each is also runnable on-demand from `/settings`, via `pnpm jobs:run-once
<name>`, or via the `launchd` plist templates in `scripts/launchd/`.

## Extending it

A few seams that are designed to be modified by users:

- **Hive Mind partner / project additions** — `/projects/onboard` joins
  Linear ↔ HM ↔ vault and walks you through importing or setting up new
  partners.
- **Hive Mind skills** — anything in `<HM-clone>/.claude/skills/<slug>/`
  shows up in `/settings → Skills`. New skills work without code changes
  if they follow the SKILL.md frontmatter contract.
- **Transcription providers** — Fathom and Granola are wired; Gemini and
  Whisper are stubs. Drop a concrete implementation into
  `apps/web/lib/server/transcription/<name>.ts` and the dispatcher picks
  it up.
- **AI prompts** — every drafting agent reads `my-voice/` for tone, and the
  call-analysis prompt is fully overridable in `/settings`. The actual
  agent code is small (one file per agent in `packages/agents/src/agents/`)
  if you want to tune behaviour beyond the prompt.

## What to read next

- **First-time setup** — [`ONBOARDING.md`](../ONBOARDING.md) walks you
  through every wizard step with expected output.
- **When something breaks** — [`TROUBLESHOOTING.md`](../TROUBLESHOOTING.md)
  has the diagnostic commands.
- **Architecture** — [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) is the
  technical layout if you want to modify or extend it.
- **How Smithers consumes Hive Mind** —
  [`docs/HIVE-MIND.md`](HIVE-MIND.md).
- **Adapter interfaces** —
  [`docs/TRANSCRIPTION-ADAPTERS.md`](TRANSCRIPTION-ADAPTERS.md) for
  transcription providers, [`docs/SKILLS.md`](SKILLS.md) for HM skills.

## Pre-release status

[TODO: replace this section with whatever framing you want for the wider-audience
release. Possible bullets:]

- Built and dogfooded by [author] against their own daily TAM work.
- Wider testing starts with [audience] in [timeframe].
- Known gaps: [list whatever you'd like testers to expect — Gemini stub,
  manual paste-to-P2 for weekly updates, etc.]
- Where to report issues / send feedback: [channel].
