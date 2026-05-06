# STATE.md — Smithers (snapshot)

_Updated 2026-05-06_

## Just completed (2026-05-06 — Hive-Mind writes live + project onboarding)

- **Hive-Mind MCP wired live (450a119)** — `RealHiveMindTransport` now spawns the local `<paths.hive_mind>/mcp/server/dist/index.js` server (was trying a non-existent npm package). New `hiveMindServerPath` MCP client option, gated by `mcps.hive_mind.enabled` + dist-file presence. Drive-by: dropped unreachable `getHiveMindNotes` MCP method.
- **Save Draft → Hive-Mind drafts/ (5fb09af)** — `saveAsDraftAction` dual-writes the AI-generated draft to `drafts/<YYYY-MM-DD>-<slug>.md` in the project's HM folder when `hive_mind_partner_slug` is set. Vault remains the editable source.
- **End-to-end smoke against The Pocket NYC Phase 2** — Add note, attach Zendesk, Process Call, Save Draft all verified live. 4 commits landed on `Team51-Hive-Mind` trunk during the smoke. Process Call write path no longer in the "not visually tested" bucket.
- **Project onboarding surface (`/projects/onboard`, bcd2d7c)** — Unified table joins Linear my-projects + Hive-Mind partners/projects + vault scratchpads. Per-row action derived from gap pattern (Open / Import / Connect / Set up). Multi-select + batch Import for the 9 reverse imports. Set Up dialog turns a Linear project into HM partner+project + vault scratchpad in one shot, with partner-slug heuristic from Linear name. Connect dialog handles vault projects without HM, auto-suggesting the partner slug from frontmatter. Repair button heals scratchpads imported by an earlier version that didn't stamp `kind: partner`. Auto-links `linear_project_id` on import when an HM project name-matches a Linear project — saves a Linear-URL paste per import.
- **Linear URL paste field on the metadata modal** — `parseLinearProjectUrl` (in `apps/web/lib/linear-url.ts` to keep the client bundle off the mcp-client barrel) auto-fills `linear_project_id` + `linear_project_slug` when you paste any Linear URL.
- **MCP client extensions** — Linear `listMyProjects()` (queries `projects(filter: members.id eq viewerId)` — Linear has no `viewer.projects` field). Hive-Mind `listPartners()`, `listProjects()`, `createPartner()`, `createProject()` with markdown-table parsers since the server returns text.
- **Vault `createProjectScratchpad` helper** — atomic write of a new project file with frontmatter pre-filled (`name`, `slug`, `kind`, `partner`, `hive_mind_*_slug`, `linear_project_id`, `created_at`) plus `## Open Items` body. Idempotent — preserves existing files. Smoke case added.
- **Webpack config: `serverExternalPackages: ["@modelcontextprotocol/sdk"]`** — the SDK uses node-only APIs (`node:crypto`, `child_process`); without this flag, `transpilePackages: ["@smithers/mcp-client"]` was making webpack try to bundle the SDK for client routes.

## Previously (2026-05-05 — Hive-Mind integration, end-to-end)

- **Hive-Mind as primary store (architectural decision)** — Team51-Hive-Mind (`/Users/katherinemccanna/Team51-Hive-Mind`) is now the canonical store for partner project data. Enables TAM handoff, team draft review, and support archive. Local vault becomes personal-only (weekly updates, style guide). MCP write tools are the write path so other TAM tools can interoperate.

- **Phase 1 complete: Hive-Mind schema extended** — Four new optional file types with templates, frontmatter schemas, and header comment blocks: `zendesk.md`, `follow-ups.md`, `call-transcripts/<date>-<slug>.md`, `drafts/<date>-<slug>.md`. `briefs/project-brief.md` added (with `google_doc_url` frontmatter for partner-shared Google Doc). `/setup-integrations` skill scaffolds these in any project folder. CI validates new file types when present. CONTRIBUTING.md and knowledge/README.md updated.
  - Call notes renamed to `call-transcripts/` throughout — template has `## Transcript` + `## Analysis` sections, `recording_url` + `transcription_service` fields (service-agnostic: Fathom, Granola, Gemini, etc.)

- **Phase 2 complete: Hive-Mind MCP write tools** — 7 new tools added to Hive-Mind MCP server: `write-project-file`, `write-partner-file`, `update-project-info`, `add-project-note`, `commit` (with push), `create-project`, `create-partner`. PR open: `feat/hive-mind-integration` → `main`.

- **Phase 3 complete: Smithers vault Hive-Mind read helpers** — `packages/vault/src/hive-mind.ts` with 5 helpers: `getHiveMindPartner`, `getHiveMindProject`, `getHiveMindNotes`, `getHiveMindCallTranscripts`, `getHiveMindDrafts`. All wired through `index.ts` (3 places each). `hiveMindPath` config option added. `hive_mind_partner_slug` / `hive_mind_project_slug` slug override fields on project vault types.

- **Hive-Mind MCP client in Smithers** — `packages/mcp-client/src/hive-mind/real.ts` extended with write methods: `writeProjectFile`, `writePartnerFile`, `commit`, `updateProjectInfo`, `addProjectNote`. Mock mirrored. Direct filesystem write helpers (`writeHiveMindCallTranscript`, `commitHiveMindFile`, `writeHiveMindPartnerKnowledge`) removed from `hive-mind-fs.ts` — replaced by MCP client calls.

- **Process Call write path updated** — Now writes call transcripts to Hive-Mind `call-transcripts/` via MCP client (`writeProjectFile` + `commit`) rather than local vault. File format: raw transcript in `## Transcript`, Smithers analysis in `## Analysis`.

- **Direct Linear MCP client** — `packages/mcp-client/src/linear/{real,mock}.ts`. 5 methods: `getProject`, `getProjectIssues`, `getProjectUpdates`, `getIssue`, `getSubtasks`. Degrades gracefully when `LINEAR_API_KEY` absent. `LINEAR_API_KEY` set in `.env.local`.

- **Phase 4 complete: Smithers workbench** — Project Status card (Linear: state, health, progress, phases, active sub-tasks), Project Log (merged notes.md + Linear updates feed, manual Add note), Partner card (read-only, file:// edit link), Zendesk panel (from zendesk.md with local vault fallback), Follow-ups (from follow-ups.md with fallback), Call Transcripts integrated with Fathom panel, Drafts list, Project Brief link (MD + Google Docs button).

- **Hive-Mind MCP PR merged** — `feat/hive-mind-integration` → `trunk` on GitHub. Local clone needs `git checkout trunk && git pull`.

## In flight

- **Migration to Hive-Mind format** — Decisions captured 2026-05-06. 2 forward (Neighborhood Nip, Shareable: vault → HM via Connect dialog), 9 reverse imports queued in /projects/onboard. Pocket NYC + body-dao already linked. Ready to execute when you want.
- **`/style-guide` editor + auto-learn loop** — designed in PLAN.md; not yet built.

## Open TODOs

In rough priority order:

1. **Run the migration** — Neighborhood Nip + Shareable Connect; Import the 8 remaining reverse imports from /projects/onboard.
2. **Build `/style-guide` editor + `/api/learn-from-archive` route** — design locked in PLAN.md.
3. **`/setup` wizard** — independent phase, designed in PLAN.md. New-TAM first-run config + OAuth + HM build check.
4. **`/today` polish** — day-specific banners, AFK state, weekend/no-data states.
5. **`/agendas/[project]` editor** — 23-line stub.
6. **`/weekly-updates/[YYYY-WN]` editor** — stub.
7. **Multi-source context for AI drafts** — design discussion needed; queued in PLAN.md.
8. **Slack thread context for partner projects** — design discussion needed; queued in PLAN.md.
9. **More AI affordances** — Summarize Zendesk thread, Verify @handles, Find related context.
10. **Bell icon + unresolved-issues count** — vault-watcher events.

## Recent decisions (with the why)

- **Vault scratchpad is permanent for every project, not transitional** (2026-05-06) — `## Open Items` (tasks) lives in vault forever; HM tracks team-shareable knowledge only. Every imported HM project gets a vault file, not just the 2 that pre-existed.
- **Onboarding surface joins Linear ↔ HM ↔ vault by slugId, then by name** (2026-05-06) — vault stores Linear's slugId as `linear_project_id` (what users paste from URLs); the GraphQL `id` is a separate UUID. Joins compare both. HM-only rows that name-match a Linear project merge automatically.
- **Auto-link `linear_project_id` on import** (2026-05-06) — saves the manual URL paste step per import. Persists the link in vault frontmatter rather than just at render time.
- **Hand-migrate, don't script** (2026-05-06) — 2 forward + 9 reverse = 11 projects total. Below the script-it threshold.
- **Hive-Mind is primary store for partner projects** — enables handoff, team draft review, support archive, multi-tool compatibility. Local vault becomes personal-only.
- **MCP write tools, not direct filesystem** — other TAMs may build their own Smithers variants; MCP is the stable interface they can rely on.
- **call-notes/ → call-transcripts/** — raw transcript is the stored artifact; Smithers-generated analysis is appended as `## Analysis`. `recording_url` + `transcription_service` are service-agnostic (Fathom, Granola, Gemini, other).
- **Project Log replaces "Project Brief" body section** — reads from `notes.md` in Hive-Mind. Auto-writes: Linear status changes, call summaries, decisions from transcripts. Manual "Add note" button. No Zendesk status change entries (noise). No migration needed from current vault project bodies (testing content only).
- **Partner knowledge: read-only sidebar card** — Zoho is source of truth; partner-knowledge.md is a curated summary. "Edit in Hive-Mind" link opens the file directly. No edit modal for now.
- **Project Brief is a separate document** — lives in `briefs/project-brief.md` in the Hive-Mind project folder. Workbench shows a link to the MD + "Open in Google Docs" button from `google_doc_url` frontmatter. Generated by `/create-brief` skill, not inline.
- **Direct Linear MCP needed for sub-tasks** — ContextA8C cannot filter issues by parent (silently drops `parent_id`/`parent` params, falls back to org-wide query). No children/sub_issues field on individual issue records. Sub-tasks of active phase issues are load-bearing for design milestone tracking.
- **deadlines.md retained as manual fallback** — Linear is primary source for project phases/status/dates. deadlines.md stays in schema for projects without a Linear project.
- **Linear project updates merged into Project Log** — posted every ~2 weeks on all projects; merged into the chronological notes.md feed alongside manual entries and call decisions.

## Known issues / works-but-feels-wrong

- **Fathom MCP 406 on first call** — `mcp-remote` to `api.fathom.ai/mcp` returns "Failed to open SSE stream: Not Acceptable" on initial tools/call; retry succeeds. Process Call doesn't auto-analyze on dialog open as a result — user has to click "Re-analyze". Issue is upstream (mcp-remote / Fathom remote), not Smithers code.
- **Fathom missed a recent recording** — call from 2026-05-05 didn't show up in the recordings list. Possibly Fathom indexing lag, possibly filtering bug in Smithers. Needs investigation.
- **The Pocket NYC partner-knowledge.md is empty** — PartnerCard renders blank until filled in. Content task, not a code task.
- **ContextA8C `comments` tool not found** — Zendesk "Recent activity" disclosures always empty. Silent degradation.
- **`gray-matter` round-trip rewrites YAML** — idempotent re-saves produce git diff noise.
- **`router.refresh()` flash of stale data** — visible on Zendesk ticket attach.
- **`Add N to Open Items` / `Add N to Follow-ups.md`** don't disable at N=0.
- **Anthropic session expiry** — periodic MCP error -32603, caught and degraded.
- **No "saving" indicator** on in-app draft editor beyond small text status.
- **`/today` not smoke-tested** — vault data shape changes (zendesk_tickets) may have stale assumptions.
