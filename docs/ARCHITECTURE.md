# Architecture

Smithers is a local web app + companion background jobs. The UI talks to local packages; those packages talk to the filesystem (vault) and to MCPs (live data). The vault is the source of truth; SQLite is cache and UI state.

## Component map

```mermaid
graph TB
    subgraph UI[apps/web — Next.js 15 App Router]
        T[/today/]
        P[/projects/[slug]/]
        D[/drafts/]
        A[/agendas/]
        F[/follow-ups/]
        W[/weekly-updates/]
        SG[/style-guide/]
        S[/settings/]
        ST[/setup/]
    end

    subgraph PKG[packages/]
        V[vault]
        M[mcp-client]
        AG[agents]
        TR[transcription]
        UI2[ui]
    end

    subgraph EXT[External]
        FS[(Vault MD files)]
        HM[(Team51-Hive-Mind clone)]
        CA[ContextA8C MCP]
        HMM[Hive Mind MCP]
        FA[Fathom MCP]
        AN[Anthropic API]
    end

    T --> V
    T --> M
    T --> AG
    P --> V
    P --> M
    P --> AG
    D --> V
    D --> AG
    W --> AG
    SG --> V

    V --> FS
    V --> HM
    M --> CA
    M --> HMM
    M --> FA
    AG --> AN
    TR --> FA

    SCH[launchd jobs]
    SCH --> V
    SCH --> M
    SCH --> AG
```

## Boundaries (the part that matters)

- **`apps/web`** is RSC-first. Reads happen in Server Components. Mutations happen in Server Actions. Client components are reserved for stateful UI (modals, editors, drag-drop).
- **`packages/vault`** is the only thing that touches the user's markdown files. It exposes typed read helpers (`readDailyNote`, `readDraft`, `listProjects`) and atomic write helpers. It owns the chokidar watcher and stable-identity reconciliation by UUID.
- **`packages/mcp-client`** wraps every MCP we call. It has typed inputs/outputs, server-side caching with stale-while-revalidate, retry-with-backoff for ContextA8C flakiness, and per-source isolation so one failing provider doesn't take everything down.
- **`packages/agents`** is the single entry point for AI work. It owns prompt templates (lives next to it in `prompts/`), composes context from vault + MCP outputs, and runs them via the Anthropic SDK or `claude` CLI. `allowedTools` is constrained per agent.
- **`packages/transcription`** is an adapter pattern: `TranscriptionAdapter { listNewRecordings, getTranscript, isHealthy }`. Fathom, Granola, and Manual paste are fully implemented; Whisper and Gemini are scaffolded stubs.
- **`packages/ui`** holds shadcn components shared across apps (currently only `apps/web`).
- **`scripts/`** contains standalone Node scripts launched by `launchd` (macOS) for scheduled work — briefing, ping monitor, Fathom sync, Hive Mind sync. Cross-platform fallback: `pnpm jobs:run-once <name>`.

## Data flow

1. **Read path:** UI page → server-side `packages/vault` + `packages/mcp-client` calls → SQLite cache check → MCP/file fetch on miss → render. Stale-while-revalidate for live data.
2. **Write path:** UI form → server action → optimistic UI update → `packages/vault` atomic write → SQLite invalidation → chokidar fires → reconciliation tick.
3. **AI path:** UI ghost button → server action → `packages/agents` runner → prompt + context assembly → Anthropic call → streamed response back to UI → user reviews → mutation goes through standard write path.

## Storage

- **Vault** (`~/Documents/A8C Claude/` by default): markdown files with YAML frontmatter. Owned by user, never silently mutated.
- **Hive Mind** (`~/Team51-Hive-Mind/` clone): markdown + frontmatter, read-mostly. Writes go through `git` with batched commits + explicit user confirmation.
- **SQLite** (`~/.smithers/data.db`): cache for MCP responses, stable-identity index, UI state, logs, audit trail. Always rebuildable from the vault + a fresh sync.

## Live data sources (via MCP)

| Source | MCP | Used for |
|---|---|---|
| Slack | ContextA8C | active threads, partner channels, ping detection |
| Linear | ContextA8C | issues, design docs, project status |
| GitHub | ContextA8C | repo metadata, recent activity, PRs |
| Zendesk | ContextA8C | partner support escalations |
| P2 | ContextA8C | post search, write-post, write-comment |
| WordPress.com | ContextA8C | site metadata, plugin info |
| Hive Mind knowledge | Hive Mind MCP | partner profiles, skills, knowledge base |
| Fathom | Fathom MCP | recordings, transcripts |

## Background jobs

Run by macOS `launchd` (definitions checked into `scripts/launchd/`):

- **morning-briefing** — Mon–Fri 7:30am local: builds /today, generates Monday weekly-update draft.
- **ping-monitor** — every 30 min during workday hours: scans Slack/Zendesk for new pings to surface.
- **fathom-sync** — every 10 min: pulls new recordings/transcripts.
- **hive-mind-sync** — every 4h (configurable): `git pull` on Hive Mind clone.

When the web app is running, an in-process `chokidar` watcher handles live vault events.

## See also

- [`PHASE6.md`](PHASE6.md) — context assembly model
- [`HIVE-MIND.md`](HIVE-MIND.md) — Hive Mind integration
- [`PROJECT-METADATA.md`](PROJECT-METADATA.md) — frontmatter contract
- [`TRANSCRIPTION-ADAPTERS.md`](TRANSCRIPTION-ADAPTERS.md) — adapter interface
