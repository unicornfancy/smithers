# STATE.md — Smithers (snapshot)

_Updated 2026-05-26_

## Just completed (2026-05-26 — migration finish, handoff readiness, /agendas editor, Zendesk summary, project hardening, settings + scheduler)

### `/settings` cards + daily briefing scheduler (39d59ac)

- **Call transcript prompt card** — textarea on `/settings` overrides the bundled `analyze-call-transcript` `SYSTEM_PROMPT` via `agents.analyze_call_transcript_prompt` in `config.local.yaml`. Shows the bundled default in a collapsible block + offers "load default" / "clear" buttons. Per-run "Additional instructions" still layers on top. New `getDefaultAnalyzeCallTranscriptPrompt()` export from `@smithers/agents` so the UI has the canonical default without duplication. Both `analyzeCallTranscript` call sites (Process Call on workbench + team-call processing on /calls) read the override from config.
- **Follow-up automation card** — four `stall_thresholds.*` inputs (nudge / escalate / force-decide / next-nudge lookahead) plus `follow_ups.default_window_days` for the To-do → Follow-up conversion pre-fill. Non-negative validation, persists on save.
- **Daily briefing schedule card** — toggleable HH:MM that pre-warms `/today`'s Top 3 + Realistic Shape generation. "Run now" button hits the new `/api/agents/briefing` endpoint synchronously. New `schedule.daily_briefing.{enabled, time}` config block.
- **In-process scheduler** — `instrumentation.ts` (runtime guard) → `instrumentation-node.ts` (node-only side). Hand-rolled `setTimeout`-to-next-HH:MM chains a new timer per fire; survives DST. Logs `[scheduler] daily briefing ...` on register + fire. Schedule changes require a dev-server restart to take effect (the timer is computed once on register).
- **`/api/agents/briefing`** — server-side wrapper for `runDailyBriefing()`. Fans out to the existing `/api/agents/top-three` and `/api/agents/realistic-shape` routes via internal fetch — no logic duplication, single source of truth for caching + daily-note writeback. Smoke-verified: ~22s end-to-end, both branches `ok:true`.
- **Optional launchd plist template** — `scripts/launchd/com.smithers.briefing.plist.example` for firing the briefing via curl when `pnpm dev` isn't running. ONBOARDING gets a one-line gotcha addendum.

### Migration to Hive-Mind — closed out (13a676b)

- **`migrate-finish-hm.mjs` one-shot script** at `packages/vault/scripts/`. Two steps: (1) for every vault project with `hive_mind_partner_slug` set, build and write HM `follow-ups.md` (mirrors the dual-write path in `[slug]/actions.ts`) then commit; (2) strip `zendesk_tickets` + `zendesk_search_terms` from the vault file via gray-matter parse + atomic write so HM `zendesk.md` is the single source of truth.
- Result: **11 HM `follow-ups.md`** files written across connected projects, **6 vault files** stripped (Pocket NYC, Body Dao, Design Matters - Phase 2, IFFS.Earth, Neighborhood Nip, Shareable). Script kept in `scripts/` as a template for future TAMs.
- Caveat: script commits to whichever HM branch the local clone is on at run time. Rerun on `trunk` to land copies there if needed.

### Handoff readiness — docs + first-run polish (2a82c3a, 8fb2768, 9dab210, a15f014)

- **`README.md` rewritten** — replaces inaccurate "pre-alpha" framing and the wizard-step list that promised features the wizard didn't implement. Now: prereqs (Node 20+, pnpm 9+, optional Hive-Mind clone), accurate quickstart, links to ONBOARDING + TROUBLESHOOTING. Architecture diagram dropped the stale `chokidar` reference.
- **`ONBOARDING.md` (new, ~200 lines)** — first-time walkthrough for a fresh TAM: prereqs, clone, HM build, dev-server start, each `/setup` wizard card with expected output, troubleshooting table for the ten most common errors, where-things-live cheat-sheet, and up-front gotchas (mock mode is the safety net, env at `apps/web/.env.local` not repo root, restart after config edits, OAuth popup flow).
- **`/setup` wizard polish** — first-run banner surfacing what's missing when essential config absent; `PathEntry` gains `is_directory` so "exists but not a directory" is a distinct warning; HM build hint corrected to `npm install && npm run build` (the HM MCP server has its own lockfile, not pnpm); `config_local.exists` distinguishes a real local-config from `config.example.yaml` fallback. `VaultMissingNotice` link now points to `/setup`.
- **Identity card on `/setup`** — name / email / github_handle / slack_handle inputs that write to `config.local.yaml`. These power the Pings-to-Action filters on `/today` (drop your own self-authored notifications) and were previously hand-edit only.
- **`requireConfiguredVault()` redirect** — `/` and `/today` redirect to `/setup` when vault path is empty, doesn't exist, or isn't a directory. Other pages keep their inline empty-state notices so a user mid-config can navigate around without being bounced.
- **CLAUDE.md fixed** — `ANTHROPIC_API_KEY` location corrected to `apps/web/.env.local` (was wrongly listed as repo root).

### `/agendas/[slug]` editor (8bfc40a)

- Fills the long-running stub. `/agendas` index lists every `Agendas/<Name>.md` with open/checked/archived counts. `/agendas/[slug]` editor: Open Items as checkboxes (optimistic toggle via `toggleAgendaItemAction`), textarea to append new items (Cmd+Enter submits), and "Archive N checked" button that moves checked rows into a fresh `## YYYY-MM-DD` section below the `---` divider. Archived sections render below as read-only markdown.
- New `@smithers/vault` helpers in `agendas.ts`: `readAgenda` (parses Open Items + archived sections, deterministic ids per row), `addAgendaItem` (creates the file/section if missing), `setAgendaItemChecked` (toggles by row id), `archiveCheckedAgendaItems` (moves all `[x]` rows into a fresh dated section). Atomic writes throughout.

### Summarize Zendesk thread AI affordance (06f9de6 + 35bb792 merge)

- New `summarize-zendesk-thread` agent — system prompt + JSON schema + validator producing `{ summary, next_step }` from an ordered comment thread.
- `summarizeZendeskThreadAction(slug, ticketId)` fetches the thread via ContextA8C (best-effort, degrades on session expiry) and runs the agent. Discriminated-union result shape.
- `SummarizeZendeskThreadButton` opens `AiDraftDialog` with the summary; copy-only flow (no save-as-draft, no subject, no frontmatter persistence). Button slots into `ZendeskRow` so it's available on both active and closed (dim) rows for post-hoc catch-up.

### `/projects` — status filter + hide-archived default (b96702b)

- New `ProjectsFilterBar` client component: status dropdown showing only statuses that have ≥1 project, each with its count. "Show archived" checkbox — archived projects are hidden by default until the user opts in. State lives in `?status=` and `?archived=` search params, filtered in the RSC page before render so counts + cards reflect the filter without a client refetch.
- Subtitle becomes "N of M" while a filter is active; otherwise the original "N total · partner · team · personal" stays.

### Project hardening — generic-slug guard, slack merge, slug fallback (1e4dc79)

- **Generic-slug guard** — new `isGenericSlug` helper in `@smithers/vault` flags `phase-N`, `redesign`, `rebuild`, `migration`, `new-site`, `v1/v2`, etc. When the HM project slug is generic, `importFromHiveMindAction` / batch import / `setupProjectFromLinearAction` prefix the vault slug with the partner so follow-up matching doesn't over-match (root cause: `Phase 2` slug was matching every `Phase 2` row in `Follow-ups.md` across the vault). Set Up + Connect dialogs show inline help text and a live amber warning showing the auto-prefixed result.
- **Slug fallback** — `readProject` now falls back to frontmatter `slug:` when the filename slugified doesn't match. Filename and frontmatter can drift without 404ing (root cause: a user-renamed file lost its URL routing).
- **Slack field merge** — `primary_slack_channel` + `team_slack_channel` collapsed into one `slack_channel` field across vault types, mcp-client refs, workbench page + actions, project metadata modal, new-project form, today/weekly fan-out helpers, and project-create lib. One vault file migrated in-place.

### Linear bugs surfaced during migration (15c43e5)

- **`getProjectIssues` UUID bug** — `issues(filter: { project: { id: { eq: $projectId } } })` requires `ID!` and rejected the short slug `8ca0b5d6870e` as "not a UUID", silently returning empty. Fixed by switching to the `project(id: String!) { issues }` connection — same lookup `getProject` and `getProjectUpdates` use, accepts both forms.
- **Live activity cache poisoning** — long-running dev server's ContextA8C cache stuck on empty arrays even after upstream healed; restart cleared it. Added `probe-pocket-activity.mjs` script alongside the existing `probe-fathom-list.mjs` for future MCP diagnostics.

## Previously (2026-05-08 PM — /today v2, weekly updates, ping-actioned, picker H5, call cleanup)

### `/today` v2 — 3-tier layout, importance scoring, velocity, flex (T1, T2, T3, T7)

- **HOT / ACTIVE / BACKGROUND tiers (78bb605)** — page reorganized into three visual weights. HOT shows top-N pings ranked by hybrid importance (priority project + partner-contact + LLM pick + small staleness tiebreaker, threshold ≥ 20) plus a "Moving fast" strip ranking partner/team projects by 7-day activity volume.
- **Backend signal helpers (`apps/web/lib/server/today-signals.ts`)** — `getProjectPriority`, `getProjectActivityCount(s)`, `extractPartnerContacts`, `computePingImportanceScore`. New `priority` field on vault Project + ProjectFrontmatter; HM `info.md` priority takes precedence when project is HM-linked.
- **`composeTopThree` confidence gate (T7)** — agent emits a self-reported `confidence: 0..1` per the rubric in its system prompt. TopThreeCard falls back to rules-only view when cached LLM confidence < 0.7, with a one-line explainer ("Claude returned low-confidence picks; click Regenerate to retry").
- **Per-section reorder + show/hide (T3, ca99542 + 0876d12)** — new `useLayoutPrefs(scope, knownIds)` hook + `SectionList` client wrapper. Edit-layout toggle in page header exposes per-section up/down + hide controls; choices persist in localStorage. Same primitive wired into `/today` and the project workbench (per-page, not per-project, for v1). Folded in the separate "Collapsible + reorderable sections on project pages" PLAN item.
- **T4 filter chips (cea8023) reverted (075d1ab)** — visual noise; chips weren't actually filtering (likely RSC cache busting issue). Stages T5 (modes) and T6 (per-day defaults) deferred unless a real itch surfaces.

### Pings to Action — already-replied detection + noise drops + project context

- **`ping_actioned` SQLite cache + Refresh button (ef02f88, d6bced7)** — schema v3 table records per-ping "did Katie reply" verdicts. Populated on demand by an explicit Refresh button on the panel header (not on every page load — per-source MCP fanout would be too slow). Detectors per source:
  - **Zendesk**: any internal-domain comment after the ping timestamp (via `get-ticket-comments`).
  - **GitHub**: any comment from configured `identity.github_handle` (falls back to "unicornfancy") after the ping timestamp.
  - **Slack**: any post from `identity.slack_handle` after the ping timestamp.
  - **Linear**: cached `viewer.id` query, any comment from viewer after the ping timestamp.
  - **P2**: skipped (no clean comment-fetch primitive).
- **Hide replied by default (24946c6)** — actioned pings now hide entirely (not just grey out); Eye/EyeOff toggle in panel header surfaces them when needed. Persists in localStorage.
- **Drop self-authored Linear pings (24946c6)** — new `identity.email` config field; Linear inbox mapper drops notifications where `actor.email` matches. Filters out the "you posted X / you changed status" noise Linear surfaces.
- **Drop projectUpdateCreated (78b2554)** — pure follower broadcasts with no link to act on. Mapper-side filter; tight noise list (only types that are *purely* informational; mentions and assignments stay).
- **Project context on Linear pings (65ed791)** — Linear inbox notifications now stash project name + Linear UUID on `ProjectMatch` (`display_label` + `linear_project_id`, `in_vault: false`). `/today` resolves to vault slug when one matches `linear_project_id` frontmatter, otherwise renders the name as a non-link label with a "set up via /projects/onboard" tooltip.
- **DB migration auto-rerun (53b473d)** — `getDb()` now re-runs idempotent migrations on every cached-handle return. Fixes "no such table: ping_actioned" after a schema bump without a server restart.
- **Hydration warnings on relative timestamps (08a09fa)** — `suppressHydrationWarning` on every span rendering `formatRelative(...)` — server vs. client drift by ~1s was triggering React's mismatch warning across pings, refresh button, live activity feed.

### Phase H5 — draft picker suggestion engine (d534a4b)

Picker dialog grows a Suggestions section between Preview and Pinned: 7-day-window project activity (Slack threads, GitHub comments, Linear issues, Zendesk comments, call transcripts) pre-populated as togglable rows. Selected suggestions resolve at Generate time (URL-based for Slack/GH/Linear, ticket-id for Zendesk, project-relative ref for call transcripts). Zendesk reply button passes `excludeZendeskTicketId` so the source ticket isn't suggested as its own context. New server actions: `getDraftContextSuggestionsAction`, `resolveCallTranscriptContextAction`, `getProjectHiveMindSlugsAction`. Closes the H5 entry from the previous session's deferred list; H6 (workbench Pinned-context affordance) still deferred.

### Call attribution cleanup (f4d6f69)

- **Shared `recordingMatchesProject` helper** — three near-duplicate fuzzy-match implementations on `/today`, `/calls`, and the project workbench were drifting on stop-words. One source of truth at `apps/web/lib/server/recording-match.ts` now drives all three.
- **Extended STOP_TOKENS** — added `site, page, new, old, wordpress, wp, web, review, dev, redesign, migration, build` after Katie hit a "site" collision: "Body Dao Acupuncture New Site" claimed "Automattic + Neighborhood Nip: Dev Site Review".
- **Per-project Detach button** — new `fathom_excluded_recording_ids` frontmatter field + "Not this project" ⊖ button on each Recent Calls workbench row. Idempotent vault helper appends; matcher returns false early when recording_id is in the exclude list. Doesn't delete the call — still appears on `/calls` and any other matching project.

### Weekly Updates — two-pane editor + AI generator + format settings (WU1, WU2)

- **`/weekly-updates` index + `/weekly-updates/[isoWeek]` editor (b0c0e51)** — Monday weekly-update workflow end-to-end (minus posting). Index lists past archived files + a "Draft this week" CTA. Editor is two-pane: facts side panel (auto-populated when Generate runs) + markdown textarea / preview toggle, plus Generate / Save / Copy buttons. Header surfaces this week's team P2 post link auto-detected via WordPress.com REST API on `team_p2_url` (falls back to homepage when private/unmatched).
- **Backend** — vault helpers `listWeeklyUpdates / readWeeklyUpdate / saveWeeklyUpdate` (writes `Weekly Updates/<YYYY-WNN>.md`), plus `listRecentCallSlices` for date-range frontmatter scans. `collectWeeklyFacts(isoWeek)` pulls per-project activity + Linear updates + recent calls + recent drafts for the ISO week. New `compose-weekly-update` agent takes facts + format template + voice + optional user-notes ("AFK Mon-Wed next week", etc.) → markdown body in Katie's per-project Last Week / This Week format.
- **Format settings card (f3745ac)** — top of `/settings`. Three preset buttons (per-project default, top-3, prioritized) load templates as starting points; free-form textarea is the source of truth. Saves to `weekly_update.format_template` in `config.local.yaml`. Drive-by: extracted YAML write helpers from `setup/actions.ts` to a shared `apps/web/lib/server/config-write.ts`.

### Earlier 2026-05-07 to 2026-05-08 — /setup wizard + Phase H

### `/setup` wizard

- **`/setup` route (d5aaffa)** — first-run experience for new TAMs picking up Smithers (the project-handoff workflow). Reads current config and surfaces what's missing: paths (vault / hive_mind / my_voice) with resolved-path badges, write-only API key inputs (anthropic / linear), MCP enable toggles (context_a8c / hive_mind / fathom) plus a Hive-Mind dist-build status indicator. Atomic writes to `config.local.yaml` (js-yaml deep-merge) and `apps/web/.env.local` (preserves blank lines + comments). Auto-redirect for missing-essential-config visitors deferred to a follow-up. Sidebar nav grew a Setup entry.

### Phase H — multi-source context for AI drafts

- **Picker dialog (2596d02)** — Every AI draft affordance (Zendesk reply, follow-up nudge, P2 update from call, post-call recap) opens `DraftContextPickerDialog` before the agent runs. Three sections: Pinned to project, Attach for this draft (Slack / GitHub / Linear / Zendesk URL paste), and No-extra-context confirmation. Generate button gated until the user has reviewed.
- **URL resolvers** — `resolveSlackUrl` / `resolveGithubUrl` on the ContextA8C client (slack `get`, github `issue`/`pull-request` with `get` + `get_comments`, response envelope unwrapping); `resolveLinearUrl` on the Linear client (issue via GraphQL `getIssue`; project via `getProject` + recent updates). Linear-quirk guard returns null when the API silently swaps in a different issue for a non-existent identifier.
- **`pinned-context.md` in Hive-Mind** — schema lives in HM (PR'd separately, merged on trunk as commit `dc26b93`). Smithers reads via new `getHiveMindPinnedContext` vault helper; writes via `pinContextAction` / `unpinContextAction` on the project workbench actions, going through the existing `write-project-file` + `commit` MCP tools. Body is intentionally NOT persisted — pins re-fetch live at use time so stale Slack threads don't leak into agent prompts.
- **AiDraftDialog grows Regenerate + Change context + preview block + learning hint** — Regenerate keeps the curated context but lets the user add one-shot intent ("shorter", "ask for screenshots"). Change context reopens the picker with state intact. Preview block surfaces e.g. the latest Zendesk partner reply at the top, persists into draft frontmatter, and renders again on `/drafts/[id]`.
- **All four draft agents accept `extra_context` and import a shared `EXTRA_CONTEXT_SYSTEM_PROMPT`** — same guidance to every agent: treat attached items as load-bearing, reference by substance not URL, prefer attached context over clarifying questions.
- **Voice routing fix** — agents now read voice from `paths.my_voice/` (SKILL + PARTNER_COMMS + INTERNAL_STYLE_GUIDE + EXTERNAL_STYLE_GUIDE + REPORT_STRUCTURE concatenated) via a new `loadStyleReference` server helper. Falls back to vault root style guide when my_voice is unconfigured. Previous behavior read only the vault root file — meaning the auto-learn-from-archive loop was write-only, agents never saw appended learnings.
- **Zendesk comments fix** — switched from the long-broken `comments` tool to `get-ticket-comments` (provider was upgraded). Mapper handles the new shape (`via.source.from.{address,name}` instead of `comment.author`) and decodes HTML entities in `plain_body`. Side effect: workbench Zendesk-Threads "Recent activity" disclosures now populate, fixing the gotcha that's been silent since the integration shipped.

### Phase H follow-ups deferred (not built)
- **H5 — suggestion engine** for the picker (recency-based pre-population from project activity feed + transcripts).
- **H6 — workbench "Pinned context" affordance** for managing pins outside of a draft flow. Pinning currently happens via the picker's "Pin permanently" checkbox.

## Previously (2026-05-06 — Hive-Mind writes, onboarding, calls, team-call notes)

### Hive-Mind writes live + Save Draft dual-write

- **Hive-Mind MCP wired live (450a119)** — `RealHiveMindTransport` now spawns the local `<paths.hive_mind>/mcp/server/dist/index.js` server (was trying a non-existent npm package). New `hiveMindServerPath` MCP client option, gated by `mcps.hive_mind.enabled` + dist-file presence. Drive-by: dropped unreachable `getHiveMindNotes` MCP method.
- **Save Draft → Hive-Mind drafts/ (5fb09af)** — `saveAsDraftAction` dual-writes the AI-generated draft to `drafts/<YYYY-MM-DD>-<slug>.md` in the project's HM folder when `hive_mind_partner_slug` is set. Vault remains the editable source.
- **End-to-end smoke against The Pocket NYC Phase 2** — Add note, attach Zendesk, Process Call, Save Draft all verified live. 4 commits landed on `Team51-Hive-Mind` trunk during the smoke. Process Call write path no longer in the "not visually tested" bucket.

### Project onboarding surface

- **`/projects/onboard` route (bcd2d7c)** — Unified table joins Linear my-projects + Hive-Mind partners/projects + vault scratchpads. Per-row action derived from gap pattern (Open / Import / Connect / Set up). Multi-select + batch Import for reverse imports. Set Up dialog turns a Linear project into HM partner+project + vault scratchpad in one shot, with partner-slug heuristic from Linear name. Connect dialog handles vault projects without HM, auto-suggesting the partner slug from frontmatter. Repair button heals scratchpads imported by an earlier version that didn't stamp `kind: partner`. Auto-links `linear_project_id` on import when an HM project name-matches a Linear project — saves a Linear-URL paste per import.
- **Linear URL paste field on the metadata modal** — `parseLinearProjectUrl` (in `apps/web/lib/linear-url.ts` to keep the client bundle off the mcp-client barrel) auto-fills `linear_project_id` + `linear_project_slug` when you paste any Linear URL.
- **MCP client extensions** — Linear `listMyProjects()` (queries `projects(filter: members.id eq viewerId)` — Linear has no `viewer.projects` field). Hive-Mind `listPartners()`, `listProjects()`, `createPartner()`, `createProject()` with markdown-table parsers since the server returns text.
- **Vault `createProjectScratchpad` helper** — atomic write of a new project file with frontmatter pre-filled (`name`, `slug`, `kind`, `partner`, `hive_mind_*_slug`, `linear_project_id`, `created_at`) plus `## Open Items` body. Idempotent — preserves existing files. Smoke case added.
- **Webpack config: `serverExternalPackages: ["@modelcontextprotocol/sdk"]`** — the SDK uses node-only APIs (`node:crypto`, `child_process`); without this flag, `transpilePackages: ["@smithers/mcp-client"]` was making webpack try to bundle the SDK for client routes.

### Phase J: Fathom matching + /calls page

- **Attendee-based recording match (0671064)** — Recordings whose meeting title doesn't include the project name (because the partner scheduled via the user's calendar link) were silently dropping. Probe of Fathom's `list_meetings` confirmed the trailing attendees segment exposes the partner's email domain. Fix: preserve `attendees` on `CallRecordingRef`, include it in the match haystack — `"thepocketnyc.com"` substring-matches `"pocket"` so the call lands automatically. Same logic also drives the new `/calls` route and `/today` Recent Calls panel.
- **`/calls` page** — full recording list split into Matched (linkable to project workbenches) and Unmatched (primary surface). Per-row "Match to project" picker writes the chosen partner identifier into `fathom_search_terms` — initial value heuristically pulled from the recording's attendee email domain.
- **`fathom_search_terms[]` on project frontmatter** — user-curated escape hatch when the heuristic isn't enough. Mirrors `zendesk_search_terms`; `setProjectFathomSearchTerms` helper wired through the vault factory.
- **`/today` Recent Calls panel** — top 5 recordings with unmatched count badge, link to `/calls`.
- **Probe script** — `packages/mcp-client/scripts/probe-fathom-list.mjs` dumps raw `list_meetings` output. Useful for future Fathom diagnostics.

### Team-call note-taking + nav

- **Process call without project (1c5c29f)** — `analyze-call-transcript` agent's `project` field is now optional; user prompt drops the `# Project` block when absent. `saveCallNotes` `project_slug` is optional; orphan calls land in `Call Notes/` without a `project_slug` field. New `analyzeTeamCallAction` + "Process" button on `/calls` unmatched rows runs the agent + saves notes for internal/team meetings the user is just note-taking on. Cache hit on `recording_id` returns the existing notes without re-running.
- **Calls in sidebar nav** — between Projects and Drafts.

### Doc cleanup

- **STATE.md fix (f2ff94c)** — confirmed `/style-guide` editor + auto-learn loop already shipped in 32e9e56 (pre-session); removed the bogus "not yet built" entry that an earlier doc refresh introduced.

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

_Nothing active. Branch is clean and ready for next pickup._

## Open TODOs

In rough priority order:

1. **Hand off to other TAMs** — README + ONBOARDING + identity card on `/setup` + vault-missing redirect + settings cards all landed 2026-05-26. Next step is sharing the repo with colleagues and watching for issues that ONBOARDING.md doesn't yet cover.
2. **Personal Digest (v2)** — newly added to PLAN.md. Weekly highlight prompt + personal development tracker. Needs a design conversation before scoping.
3. **Project briefs — attach affordance + skill integration** — discovered while reviewing Body Dao (brief lives at `brief.md`, helper reads `briefs/project-brief.md`). PLAN.md captures the attach UX + `/create-brief` skill integration questions.
4. **Remaining scheduler jobs** — daily briefing pre-warm shipped 2026-05-26; ping monitor, Fathom sync, Hive Mind sync, and learning queue drain still pending. Pattern is set: config opts in → `instrumentation-node.ts` registers timer → `/api/agents/<job>` endpoint wraps the work.
5. **`/today` view focus** — design discussion needed; queued in PLAN.md. Polish items (day-specific banners, AFK / weekend / no-data states) plus open questions about opinionated section visibility, "what changed since you last opened this," calendar integration surface, For-You-Today confidence.
6. **H6 — workbench Pinned context card** — manage pins outside of a draft flow.
7. **`/weekly-updates/[YYYY-WN]` editor** — stub.
8. **Remaining AI affordances** — Verify @handles before posting, Find related context. (Summarize Zendesk thread shipped 2026-05-26.)
9. **Bell icon + unresolved-issues count** — vault-watcher events.
10. **Auto-draft nudge when follow-up crosses escalate threshold** — the thresholds are now user-configurable; the next slice is wiring the auto-draft trigger.

## Recent decisions (with the why)

- **Hand-rolled `setTimeout` for the daily briefing instead of node-cron** (2026-05-26) — node-cron's ESM build imports `node:crypto` in a way that trips webpack's `UnhandledSchemeError` even with `serverExternalPackages`. "Daily at HH:MM" is trivial to compute (next fire-time, setTimeout, recurse), and the hand-rolled version survives DST shifts because each iteration recomputes against the wall clock. If we ever need full cron expressions, the scheduler module is the only thing to swap.
- **Split instrumentation across `instrumentation.ts` + `instrumentation-node.ts`** (2026-05-26) — Next compiles `instrumentation.ts` for BOTH runtimes (Node + Edge). Anything touching `node:*` modules (incl. our `lib/server/config.ts`) must be behind a `NEXT_RUNTIME === "nodejs"` guard AND in a separate module that's only imported in that branch, or webpack will try to bundle it for Edge and blow up. The two-file pattern is now documented in the file header for the next person who reaches for instrumentation.
- **Briefing endpoint fans out via internal `fetch` to existing routes** (2026-05-26) — `/api/agents/briefing` calls `/api/agents/top-three` and `/api/agents/realistic-shape` over localhost instead of duplicating their generation logic. Costs one self-HTTP round-trip per branch but preserves a single source of truth for caching, daily-note writeback, and the regenerate-with-force flag. Acceptable trade.
- **Schedule changes require dev-server restart** (2026-05-26) — `instrumentation-node.ts` registers the timer once on server boot from `loadConfig()`'s cached value. Live-reload would require either watching `config.local.yaml` or cancelling/re-registering on a config-change event; that polish was out of scope. The Save toast warns the user to restart.
- **Call-transcript system-prompt override lives in `config.local.yaml`, not the vault** (2026-05-26) — the agent runs server-side so the config path is the natural place; matches the `weekly_update.format_template` pattern that already shipped. The bundled default is exported from `@smithers/agents` (`getDefaultAnalyzeCallTranscriptPrompt`) so /settings can show it without duplicating the string.
- **Prefix the vault slug with the partner when the HM project slug is generic** (2026-05-26) — `Phase 2`, `redesign`, `rebuild`, etc. as a project slug poisons follow-up matching: `filterFollowUpsForProject` substring-matches any row containing "phase 2" so the per-project surface shows every partner's Phase 2 follow-ups. Auto-prefix at import (and warn in the UI when the user types one in the Set Up dialog) instead of widening the filter, because the slug being specific is also better for URLs and humans reading filenames.
- **One Slack channel field per project, not two** (2026-05-26) — `team_slack_channel` was always empty in practice; `primary_slack_channel` was the only one carrying data. Merged into `slack_channel`. Migration walked existing vault files.
- **`readProject` falls back to frontmatter slug when filename slugified doesn't match** (2026-05-26) — a renamed file in Obsidian shouldn't 404 the URL. Filename + frontmatter slug can drift; lookup is forgiving.
- **`/projects` filter: single dropdown + 'Show archived' checkbox, not chips** (2026-05-26) — chip strip considered (T4 pattern) and rejected because the schema has 9 statuses and chips become visual noise. Dropdown is compact, server-side filter via search params avoids the T4 cache-busting issue.
- **Auto-redirect to `/setup` only from `/` and `/today`** (2026-05-26) — other pages keep their inline `VaultMissingNotice` so a user mid-config can still navigate around without being bounced. The "hijack URLs while exploring" concern is real for partial config; full-redirect only on the entry points.
- **HM project commits land on the local branch the user is checked out on** (2026-05-26, observed via `migrate-finish-hm.mjs`) — script doesn't switch branches itself. Caller is responsible for `git checkout trunk` in the HM clone before running if they want commits on trunk.
- **Pinned context lives in Hive-Mind, not vault** (2026-05-07) — `pinned-context.md` is per-project and team-shareable so a second TAM working on the same project sees the same context set. Pin body is NOT persisted — only ref + label + type — and re-fetched live so the agent never sees stale Slack/GitHub content.
- **Picker gates Generate behind explicit review** (2026-05-07) — every draft affordance opens a context picker first; Generate is disabled until the user attaches ≥1 item or explicitly checks "No extra context". Prevents the agent from running on assumed defaults when context is available but unselected.
- **Agents pull voice from my-voice/, not vault root** (2026-05-07) — SKILL + PARTNER_COMMS + INTERNAL_STYLE_GUIDE + EXTERNAL_STYLE_GUIDE + REPORT_STRUCTURE concatenated. Previously read only the vault root style guide, which meant auto-learn-from-archive was write-only — agents never saw appended learnings.
- **Linear identifier-match guard against API quirk** (2026-05-08) — Linear's `issue(id:)` returns SOME other issue when the requested identifier doesn't exist (silent fuzzy-match). Verifying returned identifier matches what was asked prevents wildly wrong context from reaching the agent.
- **TAMs only import the HM projects they're actively working on** (2026-05-06) — Hive-Mind is shared across the whole team; vault scratchpads are the personal subset the user wants Smithers to track. The /projects/onboard surface lists everything but doesn't pressure users to bulk-import.
- **Match Fathom recordings via attendees, not just title** (2026-05-06) — partner-scheduled calls (calendar link) get generic titles; the attendees segment exposes the partner's email domain. Substring matching against the haystack catches the common case without per-project config.
- **Team-call processing relaxes call-notes project_slug** (2026-05-06) — orphan recordings (internal Automattic meetings the user is note-taking on) save to vault `Call Notes/` without a `project_slug` field. The analyze-call agent's `project` input is also optional now.
- **`/calls` for orphan recordings, `/today` for the day's snapshot** (2026-05-06) — `/calls` is the full list with Matched + Unmatched sections + match-to-project + team-call processing. `/today` carries a 5-row card linking to `/calls`.
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
- **The Pocket NYC partner-knowledge.md is empty** — PartnerCard renders blank until filled in. Content task, not a code task.
- **Auto-learn-from-archive has no in-flight indicator** — fire-and-forget; the success toast pops when the agent returns. Plan called for a small "learning…" pill near the archive button. Polish item, deferred.
- **`gray-matter` round-trip rewrites YAML** — idempotent re-saves produce git diff noise.
- **`router.refresh()` flash of stale data** — visible on Zendesk ticket attach.
- **`Add N to Open Items` / `Add N to Follow-ups.md`** don't disable at N=0.
- **Anthropic session expiry** — periodic MCP error -32603, caught and degraded.
- **No "saving" indicator** on in-app draft editor beyond small text status.
- **`/today` not smoke-tested** — vault data shape changes (zendesk_tickets) may have stale assumptions.
