# scripts/

Standalone Node scripts for scheduled background work and one-shot operations.

## Scheduled jobs

Each job is a Node module under `scripts/jobs/` that imports from `packages/agents` and `packages/mcp-client`. They're invoked by:

- **macOS** — `launchd` plists in `scripts/launchd/` (definitions land with the `background_jobs` todo)
- **Cross-platform fallback** — `pnpm jobs:run-once <name>` (see `run-job.mjs`)
- **Manual rerun** — buttons in the UI

Names:

- `morning-briefing` — Mon–Fri 7:30am local
- `ping-monitor` — every 30 min during workday hours
- `fathom-sync` — every 10 min
- `hive-mind-sync` — every 4 hours (configurable)

## One-shots

- `seed-demo.mjs` — populate the demo vault + fake Hive Mind clone (`pnpm seed`)
- `run-job.mjs` — manual job runner (`pnpm jobs:run-once <name>`)
