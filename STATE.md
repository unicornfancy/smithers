# STATE.md — Smithers (snapshot)

_Updated 2026-07-20_

## Just completed (2026-07-20 — v1.1.0 release: install-path hardening + rename-partner + team51 rollback)

Release theme: two new TAM-facing features, one big rollback, and a toolchain sweep driven by a real onboarding failure a new TAM hit on 2026-07-20.

### Rename Partner Slug (Settings → Diagnostics)

One-shot rename of a partner slug across every place Smithers persists it. New vault helper `renameHiveMindPartnerSlug` (in `packages/vault/src/hive-mind.ts`) rewrites every project frontmatter where `hive_mind_partner_slug` matches (and slug-shaped `partner:` values that also match), `git mv`s the Hive Mind partner directory, and commits only the renamed paths so other pending HM edits stay unstaged. Fully idempotent — safe to re-run after a partial failure. Autocomplete draws known slugs from the union of vault frontmatter + `~/Team51-Hive-Mind/knowledge/partners/`. Smoke covers invalid-slug / same-slug / missing-dir rejections and display-name preservation for projects whose `partner:` field holds "The Pocket NYC" rather than the slug.

Motivation: multiple new TAMs joining Smithers hit "slug is wrong / needs updating" and had no better path than manually editing every project's frontmatter modal + `mv` in the terminal. Card lives in Diagnostics rather than per-project because a rename can span many projects.

### Active hours gate (Settings → Workflow)

New `working_rhythm.active_hours: { start, end }` config field + `isWithinActiveHours(cfg, now)` helper in `apps/web/lib/server/active-hours.ts`. Every periodic scheduler job (ping monitor + all four sync jobs) gates on the helper at the top — outside the window (or on a non-workday), the job returns a "skipped, outside active hours" summary without calling any APIs. Daily briefing intentionally bypasses this gate — it fires at `schedule.daily_briefing.time` regardless. Time-of-day comparison uses `Intl.DateTimeFormat` with the configured timezone so a Smithers laptop that travels still honors "9am Pacific" instead of "9am wherever the laptop woke up." Windows that wrap midnight (`start > end`, e.g. 22:00–06:00) are handled correctly. Fail-open on Intl errors — better to over-run than starve.

Motivation: Katie observed background jobs firing after-hours and on weekends when she wasn't around, burning tokens on results she wasn't looking at. Config-first rollout: no `active_hours` block → legacy behavior (jobs fire whenever), same as before.

### team51 CLI provisioning: full rollback on main

The Terminal-launched team51 flow that shipped 2026-07-08 hit real errors when Katie tried to use it end-to-end. Rather than patch in-place, the entire feature (~2400 lines, 15 files) is deleted on main and preserved on the `team51-cli-v1` branch (pushed to origin) for a future rebuild. Removed: workbench Provisioning section, all per-command dialogs (wpcom-create-site, wpcom-clone-site, pressable-create-site, pressable-clone-site, run-wp-cli), Terminal-launched runner + postback endpoint, run-poll + write-back components. Schema migration V8 drops `team51_runs` (safe on both freshly-seeded DBs and legacy ones that ran V6+V7). ONBOARDING gotcha about macOS Automation permission removed.

Deferred-work follow-up added to PLAN for the v2 rebuild.

### Node 22 LTS + pnpm 11 + hardened install path

Full trigger: on 2026-07-20 a new TAM (Kim) started fresh onboarding and hit two blockers in step 2 (`pnpm install`) — (1) her global pnpm was 11.15.1 from Homebrew, project pinned 10.33.2; pnpm 11 stopped reading `pnpm.overrides` from package.json AND rejected the lockfile; (2) her Node was 26.5.0 (also from Homebrew), which has no prebuilt `better-sqlite3` binary yet, so it fell back to source compilation that failed on a stale CLT receipt.

Response was in three parts:

1. **Bump Node 20 → 22 LTS.** Node 20 hits EOL April 2026 (three months before this release); 22 is supported through April 2027. `.nvmrc` + engines in root package.json updated.
2. **Bump pnpm 10 → 11.** Pinned version now 11.15.1, matching what a fresh Homebrew install of pnpm gives you (though corepack now handles this anyway — see #3). Config migrations: `pnpm.overrides` moved from package.json to pnpm-workspace.yaml (its new pnpm 11 home). `onlyBuiltDependencies` (list of strings) replaced by `allowBuilds` (map of booleans) — added esbuild + sharp alongside better-sqlite3 so all three native modules build on install rather than being silently skipped. Lockfile regenerated in pnpm 11 format.
3. **ONBOARDING rewrite of step 1 (install tools) + step 2 (install deps).** Now: nvm instead of `brew install node` (because brew always chases latest, drifting past `.nvmrc`); corepack instead of `brew install pnpm` (because corepack auto-fetches the pinned pnpm from `packageManager` — so a pnpm major bump never breaks anyone's install again). Explicit "verify you're on the right versions" checkpoint between install and `pnpm dev`, with fold-outs for the exact three errors Kim hit so future TAMs recognize them and know the fix. Two rows added to the bottom-of-doc troubleshooting table for the same errors.

The install path is now durable across ecosystem drift — the pinned versions are the pinned versions, regardless of what Homebrew was serving on any given day.

### Also shipped this cycle (between 2026-07-08 and 2026-07-20)

- **Call notes Chat visibility fix.** On 2026-07-10 during a Body Dao call, only the first lines of the chat saved to the notes file — mid-chat markdown H2 headings in an assistant reply were terminating the reader regex. Fix: wrap `## Chat` sections with HTML comment sentinels (`<!-- smithers:chat-start --> ... <!-- smithers:chat-end -->`) so the reader anchors on the comment, not the heading. Legacy regex fallback preserved for files written before the fix. Chat card added above Transcript card on `/calls/notes/[id]` — chat had been saving to file but never rendering.
- **Personal notes made editable.** Was a read-only markdown-render + `<ComingSoon />` stub. Replaced with `PersonalNotesEditor` client component (1500ms debounced autosave + save-on-blur + edit/preview toggle) and a new `writeProjectPersonalNotes` vault helper with layout-aware paths (`<folder>/notes.md` for folder-projects, `Projects/<basename> — notes.md` for flat).

## Just completed (2026-07-08 — team51 CLI: scrap subprocess, switch to Terminal-launched)

The subprocess-based team51 integration shipped 2026-07-07 never worked against 1Password's desktop CLI integration. Root cause traced across a ~30-message debugging session: 1Password 8's ancestry-based caller authorization refuses `op` when the direct parent is `node` (Smithers's dev server) — and no shell-wrapping trick reliably fools it once pnpm dev has been restarted via the in-app button (which detaches from Terminal → no shell ancestor at all).

Katie proposed the pivot that actually works: **Smithers composes the command from a web form, writes a shell script that runs it + POSTs the log back on completion, then AppleScripts Terminal.app to open the script.** The CLI runs interactively in a real Terminal window — every prompt, every biometric, every ancestry check works because a real terminal is a real terminal.

### What replaced what

- `startTeam51Run` no longer spawns a Node subprocess. It writes `/tmp/smithers-team51-<id>.sh`, `osascript`s Terminal.app to open it, and returns the run_id.
- The generated script tees the CLI output to a log file, then `curl`s the log + exit code back to `POST /api/team51/complete/[runId]?token=<one-time>`. The script leaves the terminal window open until the user hits Return — so they can read the outcome.
- `completeTeam51Run` (in `team51.ts`) validates the one-time token (constant-time compare), classifies success / failure by exit code, parses the log for a URL via per-command regex, and offers a one-click write-back on the detail page. All three create/clone variants write to `staging_url` — the fresh URLs from team51 (`foo.wordpress.com`, `foo.mystagingwebsite.com`) are pre-launch; `production_url` is reserved for the final launch URL the partner will use.
- Migration V7 adds `postback_token` (nulled after completion) and `captured_url` columns to `team51_runs`.
- New `Team51RunPoll` client component polls the detail page every 3s while status is queued/running so it transitions to completed/failed as soon as the postback fires.
- New `Team51WriteBackButton` on the completed state: writes the captured URL to project frontmatter idempotently, shows a confirmation.

### What got scrapped

- `Team51ToolsCard` in Diagnostics (external-tool probes are unnecessary — the terminal shows any auth failures inline).
- `/api/dev/team51-tools` route.
- `Team51RunControls` (cancel button — user cancels in the terminal with Ctrl+C).
- `Team51FailedCard`'s seven-way `failure_kind` switch (kept a lightweight `classifyFailureFromLog` for coloring but the log itself is the diagnostic).
- `probeExternalTools`, `probeOp`, `probeGh`, `probeSsh`, `classifyGate`, `classifyTeam51Failure` — all the subprocess-era classification and pre-flight code.
- The `required_tools` field on `StartTeam51RunInput`.
- The 1Password ancestry guidance in ONBOARDING (no longer applicable) — replaced with a one-time macOS Automation permission callout.

### Trade-offs the new design accepts

- No live log tail in Smithers during the run. The user watches the Terminal window; Smithers's detail page shows the log after postback.
- First AppleScript invocation triggers a macOS Automation permission dialog. One-time — the OS remembers Allow.
- Session state can be interrupted if the user closes the terminal early. The CLI still finishes and the site still gets created; Smithers just doesn't get the URL for automatic frontmatter write-back. Log is still on disk.
- macOS-only (already a Smithers-wide constraint).

### The four workflows still ship

`wpcom:create-site`, `pressable:create-site`, `pressable:clone-site`, `wpcom/pressable:run-site-wp-cli-command`. Same dialogs, same forms, same pre-fill from project frontmatter. Only the internals of `startTeam51Run` changed. `--no-interaction` is no longer appended — the CLI's own confirmation prompt fires naturally in the terminal.

## Just completed (2026-07-07 — team51 CLI shell-out integration)

Smithers can now drive the team51 CLI (Symfony Console PHP app at
`/usr/local/bin/team51` → `~/team51-cli/team51-cli.php`) from
project workbenches. Four workflows ship in v1: `wpcom:create-site`,
`pressable:create-site`, `pressable:clone-site` (launch-day), and
one shared `run-site-wp-cli-command` dialog covering the WPCOM +
Pressable variants.

### How the CLI-prompt problem was solved

The team51 CLI's Symfony Console commands prompt for missing args
during `initialize()` + `interact()`. Piping that through a web UI
would need a pty — complex, fragile, no real UX win. Instead
Smithers renders a web form matching each command's declared args
+ options (grepped from `~/team51-cli/commands/*.php`), pre-fills
from project frontmatter, and spawns with `--no-interaction`
appended so the CLI never blocks on a prompt. Symfony's built-in
confirmation prompt (which `-n` short-circuits to false) is
replaced by an in-dialog confirmation banner + Create button.

### Foundation module

- `apps/web/lib/server/team51.ts`:
  - `resolveTeam51Binary()` probes Homebrew paths + `/usr/bin` +
    `SMITHERS_TEAM51_PATH` escape hatch (same pattern as `gh`).
  - `startTeam51Run()` inserts a `team51_runs` row, runs external-
    tool pre-flight if the caller declared `required_tools`, then
    spawns the child with `--no-interaction`. stdout/stderr stream
    to `~/.smithers/team51-logs/<run_id>.log`. On exit, classifies.
  - `classifyTeam51Failure()` maps stderr tail + exit code to
    structured `Team51FailureKind`: `user-cancelled`,
    `duplicate-resource`, `auth-failed`, `missing-arg`, `timeout`,
    `unknown-command`, `external-auth-failed:<tool>`,
    `generic-failure`. Symfony-native error patterns for the first
    four; `op` / `gh` patterns for the fifth.
  - `probeExternalTools()` runs `op whoami`, `gh auth status`, and
    GitHub SSH `-T BatchMode=yes` with 5s timeouts. Powers both
    pre-flight and the Diagnostics probe card.
  - `cancelTeam51Run()` SIGTERM + row stamp.
- New `team51_runs` table (migration V6, additive) mirrors
  `qa_runs`: id, project_slug, command, command_group, args_json,
  status, timings, pid, exit_code, log_path, failure_kind,
  error_message, result_json.

### Provisioning card on the workbench

Sits on the Knowledge tab under `id: "team51-provisioning"`,
partner-projects only. Four buttons: Create WordPress.com site,
Create Pressable site, Clone Pressable site, Run WP-CLI. Recent
runs list underneath with status pill + link to the detail page.

### Failure recovery cards

`/projects/[slug]/team51/[runId]` uses the same shape as the Kosh
QA detail page. `Team51FailedCard` switches on `failure_kind` and
renders seven branches — each pointing at the actionable fix. The
`external-auth-failed:op` branch calls out the 1Password 8 desktop
CLI integration as the durable fix (session-based `op signin`
lives in the terminal that spawned `pnpm dev` and expires ~30 min).

### Diagnostics probe card

Settings → Diagnostics → **Team51 CLI + external tools** runs the
same probes the pre-flight uses (`op` / `gh` / GitHub SSH). Green
check on pass; red X with the fix command inline on fail. Backed
by `GET /api/dev/team51-tools?tools=op,gh`.

### ONBOARDING callout

New Day-to-day gotcha explaining why 1Password 8 CLI integration
matters for Smithers's Provisioning workflows.

### Deliberately out of scope for this pass

- **Post-success frontmatter write-back** — the CLI prints new
  site URLs at the end of a create-site run; we haven't parsed
  them into `staging_url` / `production_url` yet. Log tail carries
  the info for now.
- **Interactive resume** for CLIs that need mid-run input (same
  category as Kosh v2's reachability-gate pause). Not built for
  team51 since the current commands work fully non-interactively.

## Just completed (2026-06-24 → 2026-07-06 — v1.0 release + polish sweep)

The month between v0.2.1 and 1.0. Two large new features (SITREP + AFK), a /today expansion, Kosh QA cleanup, an in-app updater, and about a dozen fixes that shook out as more TAMs started installing.

### v1.0 shipped (ac702e9, 09a7a43, 14fb68e onward)

- Sidebar label `v0.0.1 · pre-alpha` → `v1.0.0`; the AppHeader "pre-alpha" chip dropped (09a7a43).
- OVERVIEW.md dropped its Draft banner; added /today's new cards, /afk, /digest, and /projects/[slug]/qa to the Surfaces table; added SITREP / AFK / Kosh QA to AI affordances; documented Update Smithers next to Restart; replaced "Pre-release status" TODO with a 1.0 release status listing what's in and what's deferred.
- README pitch refreshed for Waiting on you / SITREP / AFK / self-updating. ONBOARDING callout for Update Smithers next to Restart.
- Tagged `v1.0.0` and pushed. GitHub Release created with the same content.
- Companion vault draft `Drafts/Smithers v1.0 P2 announcement.md` for the internal P2 post.

### `/today` expansion (993a545, c5f205f, 2e36427, 852784f, 7ad87f7)

Three new /today cards inserted after the highlight banner:
- **Waiting on you** — cross-project Zendesk threads where the partner replied last, sorted by most-recent reply first (older = false-positive tail). Shared `makeAuthorNameMatcher` extracted from `weekly-facts.ts` so /today and the weekly-update generator use the same signature logic. Matcher gained a first-name-in-tail fallback so "Best, / Katie" style two-line sign-offs classify correctly (852784f).
- **@-Mentions** — Linear `*Mention*` notification_type pings + GitHub @-mention pings filtered from the existing Pings feed.
- **Deadlines** — Linear projects with `targetDate` inside a configurable window (default 14 days; `today.deadlines_window_days` in config, editable from Settings → Workflow).

Plus new `runZendeskStatusSyncJob` scheduler + `/api/jobs/zendesk-status-sync` — periodic re-poll of every attached ticket across all partner/team projects so the Waiting on you card doesn't surface tickets someone else already closed. Per-TAM signature aliases for the matcher (nicknames, initials, last-name-only sig) noted in PLAN as a deferred enhancement (7ad87f7).

### SITREP composer (4d43d18, 2c0aa00, f8b6ced, ed177be)

Workbench Knowledge tab → paste-ready P2 comment for a project's status post.

- New `compose-sitrep` agent + `composeSitrepAction` + `GenerateSitrepButton` + section card. Gathers Linear (project + updates + open issues), primary Zendesk thread + recent activity, open follow-ups; drafts markdown with a status one-liner (with Linear health + link), latest activity, primary Zendesk thread, open items / what's next. Copy-only — no auto-post (4d43d18).
- Fix: primary Zendesk recent activity was slicing the wrong end of a newest-first array (`slice(-6)` = oldest 6). Now `slice(0, 6).reverse()` per the field's oldest-first contract, so the agent sees fresh partner replies (2c0aa00).
- Prompt tweaks: Linear project link appended to the Status line when set (f8b6ced); `## SITREP - <iso_date>` H2 title; primary-Zendesk line labeled `**Primary Zendesk thread:**` (ed177be).

### AFK handoff post (a56549a, 7084c71, 72ea27f, aa83c39, 14fb68e)

New `/afk` route + sidebar entry + `compose-afk-notes` agent. Pick date range + coverage handle + optional intro; per-project Linear/Zendesk/follow-up snapshots stitched into a single markdown post ordered hot / at-risk first, then active. Copy-only.

Later restructured to a strict per-project shape after Katie flagged the earlier layout as noisy:

```
### [Project Name](p2_url)
**[Primary Zendesk thread](url). [Slack channel](url). [Linear](url).**
TAM Coverage: <handle>
Latest Activity: <summary>
Next Steps: <coverage-period work only>
```

- Bold-line link tokens degrade individually; the whole line drops only if all three URLs are missing. H3 falls back to plain text when p2_url is missing.
- `resolveSlackUrl` helper normalizes `project.slack_channel` (accepts full URL, bare channel id `C0BBXNBDKCP`, or plain name → `a8c.slack.com/channels/<name>`).
- Intro no longer promises "I'll check messages once a day" — Automattic AFK culture treats time off as fully off. Default close now reads `"<coverage_handle> has the wheel — please send anything urgent their way."` (14fb68e).
- Linear-secondary-TAM lookup for a per-project coverage override (`tam_coverage_override`) plumbed but unfilled in v1 — see PLAN.

### Kosh QA polish (7b80461, 05546eb, c01d48a)

- Cancel button on every queued / running row in the launcher card (was only on the detail page); toast text differs by state ("Cancelled run" vs "Removed from queue").
- Coming Soon tip above the URL input pointing at the WPCOM Share Link workaround for splash-mode sites.
- Fixed `spawn gh ENOENT` in the Findings → GH Issue flow. Next.js server actions can run with a stripped PATH that omits Homebrew locations. First attempt used `/usr/bin/which gh` — but `which` searches the *spawn's* PATH, which was the very thing missing `/usr/local/bin`. Final fix: probe `/opt/homebrew/bin/gh`, `/usr/local/bin/gh`, `/usr/bin/gh` directly; `SMITHERS_GH_PATH` env override for exotic installs (05546eb → c01d48a).

### Update Smithers card (397e726)

Settings → Diagnostics grew an **Update Smithers** card next to Restart. `POST /api/dev/update` runs `git fetch + pull --rebase --ff-only origin main` from the repo root; refuses to run with a dirty tree or off `main`. Reports whether `package.json` / `pnpm-lock.yaml` moved and hints `pnpm install + Restart` when they did. `GET` on the same route serves the current branch + HEAD oneline so the card always shows what version is running. No auto-install / auto-restart.

### Call processing dialog stays open across accepts (f16c516)

The `ProcessCallDialog` was mounted inside `unprocessedRecordings.map(...)` on the workbench. `analyzeCallAction` writes a Call Notes file, so after analyze the recording is technically "processed" — the next `router.refresh()` inside `acceptActions` re-rendered the workbench, the unprocessed row unmounted, and the dialog vanished before the user could push follow-ups or decisions. Moved the single `router.refresh()` to Dialog `onOpenChange` (fires on close), and dropped it from the three accept handlers.

Same commit: `acceptCallDecisionsAction` was wrapping its HM notes.md mirror in `try { ... } catch { /* swallow */ }`, hiding failures. Now returns an optional `warnings[]` that the dialog surfaces via `toast.warning`. Vault-only projects also surface a warning that the Project Log panel doesn't read the body's `## Decisions` section.

### Decisions log fix — bootstrap missing notes.md (c84772a)

The HM MCP's `add-project-note` tool errors out when `notes.md` doesn't exist. HM projects scaffolded outside the standard `create-project` flow (e.g. WordPress Certifications) have `brief.md` + `call-transcripts/` but no `notes.md`, so every decision-log mirror silently failed. New `ensureHiveMindProjectNotes` vault helper seeds the file with a `# Notes` heading on first write. Idempotent.

### Zendesk refresh saga (974e86f → 554630d → 4c55011 → e68e7b3)

The workbench Refresh button was missing newly-closed tickets on The Pocket NYC (60+ tickets). Four commits before it worked:

1. Lift `per_page` from 50 to Zendesk's API ceiling of 100 (974e86f). Not enough alone.
2. Dropped the added `sort_by`/`sort_order` — the MCP tool likely doesn't whitelist them, so the whole call was rejecting silently. Added per-hint diagnostics to the toast so we could see hit counts, matched counts, and unseen ticket IDs (554630d).
3. Partitioned the search into 3 status-scoped passes per hint (`status<solved`, `status:solved`, `status:closed`) so each bucket gets its own 100-row window (4c55011). Still missed 8 of 12 attached tickets.
4. Root cause: the 8 missing tickets had subjects like "Google Site Kit setup" — partner-related but the partner name appeared nowhere in searchable text, so text-hint search literally could not match them. Fix: plumb partner contact emails from `hiveMindPartner.contacts[]` and add `requester:<email>` search passes alongside text hints (e68e7b3). For The Pocket that's now 2 hints × 3 statuses + 2 emails × 3 statuses = 12 total searches per refresh — enough to catch every attached ticket.

### Workbench MCP timeout guards (a7a23fb)

`Promise.all` block on the project workbench had three MCP calls with no `.catch()` — `contextA8C.listProjectActivity`, `hiveMind.getPartner`, `transcription.listRecordings`. A fresh user with unauthed MCPs would hit MCP -32001 and crash the whole page render. Each now degrades to an empty result matching the pattern the rest of the block already uses.

### React key + stop-token fixes for the calls list (9a59623, 383b326)

- `ProcessedCallRow` used `recording_id || title` as its React key. Legacy hand-saved Call Notes have no recording_id (they route through the filename-fallback path added earlier); Dropbox conflict-resolution + Fathom's `(1)` / `(2)` exports can produce multiple files with identical extracted titles → duplicate key warning, possibly dropped rows. New `rowKey()` falls back to `title + recorded_at + index`.
- `partner: Automattic` internal projects (Certifications, Transparency) were claiming every Fathom recording / orphan Call Notes file because the partner tokenized to `automattic` — the company prefix on every internal call. Added `automattic` + `a8c` to `STOP_TOKENS` in `recording-match.ts`.

### Small fixes worth logging

- **Drafts archive 404** (d68a3f7) — path-derived `local:Drafts/<name>` ids change when the file moves to `Drafts/Archived Drafts/`; `router.refresh()` on the same URL then 404'd. Push to `/drafts` after archive instead.
- **Legacy Call Notes filename fallback** (220442a) — `Call Notes/` files without frontmatter (hand-saved Fathom exports) never surfaced on the workbench. New `listOrphanCallNotes()` walks the folder for files lacking `project_slug`; page filters via the existing `recordingMatchesProject`; merges as processed-call rows with empty `recording_id` (UI suppresses Process/View buttons — just shows date + title).

## Just completed (2026-06-02 PM — Ask Smithers Cmd-K palette: A + B + C)

Ships the full Ask Smithers palette in one session — global Cmd-K overlay with 9 structured actions across vault projects + open follow-ups, plus an LLM dispatcher for free-form queries. Replaces (and removes) the standalone `/search` page.

### Slice A — foundation + Navigation + Add task

- **`lib/server/palette-index.ts`** unified index across vault projects, HM partners, HM projects not in vault, open follow-ups, and the static-pages catalog. 5-min in-process cache.
- **`/api/palette-index`** GET endpoint, `?force=1` bypasses the server cache.
- **`lib/palette-score.ts`** token-based scorer: `label*3 + description*1 + kindBoost + recencyBoost`. No fuzzy library. Exact-word=5, prefix-word=3, substring=1 per token.
- **`AskSmithersPalette`** global client component mounted in `app/layout.tsx`. Cmd/Ctrl-K toggles open; also listens for a `smithers:open-palette` `CustomEvent` so any client can trigger the open without faking key events.
- Sidebar gets a sticky "Ask Smithers ⌘K" affordance at the top; the old "Search HM" item is gone.
- Two-step interaction: type → results → pick action → action-specific form. Single-action entries (pages, HM partners, HM projects) skip the action step and Enter navigates immediately.

### Slice B — six more actions (project) + two more (follow-ups)

- **Project-vault entries** now expose: View status, Add task, Add follow-up, Mark task done, Set status, Attach Zendesk. Six new step kinds in the palette state machine, each with arrow-key picker + Esc-back navigation.
- **`/api/palette-project/[slug]`** single endpoint serving both View status (status, priority, kind, partner, open-tasks count, open-followups count, ZD count, last-touched) and Mark task done (open-tasks list). Lazy-loaded per slug; results cached per-session in the client.
- **Follow-up entries** expose Resolve + Snooze (3d / 1w / 2w / 1mo presets).
- **`snoozeFollowUpAction` now accepts an empty project slug** so the palette can run it on a global follow-up entry without inventing a slug — revalidates `/follow-ups` instead of a project page.
- All actions reuse existing server actions in `[slug]/actions.ts` — no duplication.

### Slice C — LLM dispatcher + helpful text

- **`interpret-palette-query` agent** in `packages/agents/`: input is the user's free-form query + the palette index + open tasks (capped at 80) + open follow-ups + today. Output is one structured intent (or `unknown`) with params + a one-sentence confirmation + a 0..1 confidence. Effort: low, maxTokens 512 — fast roundtrip.
- **`/api/palette-query`** POST endpoint runs the agent and returns `{ok, data: AiIntent}` or `{ok:false, reason, message}` when ANTHROPIC_API_KEY isn't set / the run fails.
- **"Ask Smithers: <query>" row** pinned at the top of results whenever the query is non-empty. Enter on it → `ai-interpreting` (spinner) → `ai-confirm` (intent + params + confidence visible — Enter to run, Esc to back). Low-confidence (<0.5) or `unknown` intent → an `ai-error` state with a "try a more specific phrasing" hint.
- **`runAiIntent` routes intents back to the same server actions** the structured catalog uses — single source of truth for mutations. The agent never writes; it only interprets.
- **Helpful text** under the search input: *"Pick a project to add tasks, follow-ups, set status, attach Zendesk tickets, and more. Pick a follow-up to resolve or snooze it."* Empty-state copy now reads *"Start typing to search across projects, partners, follow-ups, and pages."* For nav-only entries (page / partner-hm / project-hm), the action menu appends a contextual note explaining why no actions are offered and pointing at vault projects.

Smoke: `POST /api/palette-query {query:"add task to body dao: review staging url"}` → intent `add-task`, confidence 0.95, correct entry_id + task_text. `{query:"what is the status of body dao"}` → `view-status` 0.95. Garbage → `unknown` 0.

## Just completed (2026-06-02 — JOB_CONTEXT.md loop closes: roster sync + @handle verification)

Three commits, all feeding the JOB_CONTEXT.md / agent-context loop introduced 2026-05-29.

### Style-guide editor stability + Matticspace team roster sync (13df837)

- **`/style-guide` editor stops shifting under the cursor.** Both columns now `h-[70vh]` (strict height, internal scroll on the preview) instead of `min-h-[70vh]`. CSS Grid's default `align-items: stretch` was dragging the textarea taller in lockstep with the live preview growing as content grew. Save-status text gets a fixed 120px right-aligned slot so the "Learn from archives" button doesn't shift as the status cycles.
- **Team roster sync v1.** New `mcp.contextA8C.listMatticspaceGroupMembers(slug, opts)` with 1h SWR cache + serializable `MatticspaceGroupRoster` type. `lib/server/team-roster.ts` reads JOB_CONTEXT.md, finds/inserts `<!-- BEGIN matticspace-<slug> --> / <!-- END --> ` markers inside the "Common collaborators" section, renders an alphabetical-with-leads-first markdown list, atomic write. Decodes HTML entities (`&amp;` → `&` etc.) from matticspace strings. Idempotent. New `runTeamRosterSyncJob` + `/api/jobs/team-roster-sync` + `instrumentation-node` registration + `IntervalJobCard` on `/settings → Workflow`. Default disabled; weekly cadence.

### Multi-group sync (613e400)

- `team_roster_sync.group_slug` (singular, legacy) → `group_slugs[]` (plural). Each group gets its own BEGIN/END block in JOB_CONTEXT.md. Default: `["team-51", "team-51-contractors", "studio-51"]` — contractors live in the standalone `team-51-contractors` group (not a sub-team so `include_subteams: true` doesn't reach them), and studio-51 holds the in-house designers (Christy Nyiri, Allan Cole, Dave Whitley, Diana Costa, Pedro Azpurua, Zeljko Gudelj).
- New `syncTeamRostersToJobContext` orchestrator loops over slugs; per-group results bubble up in the `JobResult`'s `groups[]`.
- `team_group: "None"` labels stripped from the rendered output — contractors have no sub-team membership so the field reads "None" upstream and adds no signal. Their `job_title` carries the meaningful info ("Contract designer on Team 51-Launch").
- Summary now reads e.g. `"58 members synced (team-51=30 team-51-contractors=22 studio-51=6*)"` — trailing `*` marks which groups actually changed on disk.

### @-handle verification banner (e58ee8f)

Closes the long-deferred "Verify @handles before posting" PLAN item. The team-roster sync gave us the canonical wp_username for every member; drafts now check their mentions against that source of truth before they ship to P2.

- `getMatticspaceHandleMap()` server util builds a serializable lookup from the cached roster: `known_wp_usernames[]` plus `by_candidate: Record<string, Person[]>` keyed by first-name slug, last-name slug, full-kebab, full-concat.
- `/api/handle-map` exposes the map to the client (no-cache headers — fresh from server SWR every load).
- `<HandleCheckBanner>` client component scans the draft, classifies @-mentions as already-correct / suggested / ambiguous / unknown, renders per-suggestion "Apply" buttons that rewrite `@typed → @suggested` in the textarea. Unknown mentions collapse into a soft-warning details block. Hides itself when nothing's flagged.
- Wired into the weekly-update editor (above the draft body) and AiDraftDialog (below the body textarea). Client-side string matching, no debounce needed.

Smoke: `@christy` → `@nyiriland (Christy Nyiri)`. `@nyiri` → same. `@nyriland` (the typo) → flagged unknown so it doesn't silently ship.

### Live Activity row → +Task button (69dc6ba)

Covers the "I need to do something about this even though I wasn't tagged" case that the existing "Watch for reply" button doesn't handle. Each ActivityRow gets a small `+ Task` button (opacity-0 → group-hover:1 so it doesn't clutter the feed).

- `addProjectTaskFromActivityAction` appends to the project's Open Items via the existing vault helper, embedding the activity URL as a trailing markdown link: `- [ ] {prefilled text} — [source](https://...)`. Source-ref persistence is "free" via the markdown link — parseable for a future auto-mark-done slice without needing a separate ref store.
- `AddTaskFromActivityButton` opens a small dialog with editable prefill. Verb chosen from source/kind (Reply to / Respond to / Follow up on / Review), tags the actor's first name + "(partner)" badge when external, labels the source. User edits, hits Add, task lands in the vault file.
- Workbench passes its own `projectSlug`; cross-project surfaces fall back to `event.project_match.project_slug` when `in_vault` is true. Button hides when no project target.

### HM sync now also pushes local-ahead commits (831a20f)

The original 2026-05-27 job only pulled. Smithers-generated commits (Process Call writes call-transcripts; brief generation writes brief.md; project-handoff writes handoff-*.md; etc.) stacked up locally until manually pushed — meaning colleagues couldn't see Smithers-authored work until that happened. Surfaced when Katie noticed colleague edits weren't showing in Smithers: local was 1 ahead, 6 behind, `--ff-only` would have rejected the next sync.

- `git fetch` first to know ahead/behind exactly via `rev-list --count --left-right @{u}...HEAD`.
- Behind-only → `git pull --ff-only` (unchanged).
- Diverged (behind AND ahead) → `git pull --rebase` to replay local commits onto the new remote.
- After pull, check ahead-count again (rebase preserves local commits with new SHAs) and `git push` if anything to share.
- Summary string reads e.g. `"rebased 1 local commit(s) onto 6 new remote · pushed 1 local commit(s)"`.
- Still skips on a dirty working tree — that case warrants the user's attention and is too risky for an automatic rebase.

Also enabled the job in Katie's `config.local.yaml` so the next 30-min tick keeps things in sync without manual intervention.

## Just completed (2026-05-29 — skills integration sweep: About + /project-handoff + /search-knowledge + /update-knowledge)

Closes the PLAN.md "Skill integration — remaining queue" entry in a single session by reusing the runtime-skill-loader foundation 9039c16 introduced.

### About card replaces the Settings placeholder (0500deb)

- New `AboutCard` on `/settings → About` reads the running version from the root `package.json`, the active Anthropic model from `config.agents.model`, and the resolved repo root from the shared `findRepoRoot` helper. File-link shortcuts under "Docs on disk" open README / ONBOARDING / TROUBLESHOOTING / CLAUDE.md via `file://`. Closing note points at PLAN.md / STATE.md as the issue-tracking surface since there's no remote.
- Drops the now-unused `PlaceholderCard` import from `/settings`.

### `/project-handoff` workbench wizard (42c5218)

- `generateProjectHandoffAction` mirrors the brief shape: pre-gathers vault project + HM partner-knowledge + HM project info + Linear project metadata (when linked), feeds the four user-context fields into `runHiveMindSkill` with the `/project-handoff` skill body and declared dependencies. The skill's MCP-side crawl phases (deep Linear, P2, Zendesk threads, GitHub open issues) are skipped — the run-skill agent has no MCP — so missing data comes back under `questions` for the user.
- `saveProjectHandoffAction` writes the reviewed markdown to `handoff-<YYYY-MM-DD>.md` in the project's HM folder (per the skill's default save path) and commits.
- `HandoffGeneratorDialog` + `GenerateHandoffButton`: four textareas for the skill's phase-4 inputs (locally tracked work / upcoming calls / critical context / exclude) plus a Prepared-by input pre-filled from `identity.name`. Review phase shows questions inline; markdown is editable before save.
- Surfaced as a ghost "Handoff" button in `WorkbenchHeader`, gated on `hive_mind_partner_slug` so personal/team projects don't show it.

### `/search-knowledge` — `/search` page over the HM MCP (4c988cd)

- New `/search` page surfaces the HM MCP's existing `searchKnowledge` tool (already wired on the client side). State lives in `?q=` so results are deep-linkable + survive back/forward. `SearchInput` client component owns the field; the page re-runs server-side from `searchParams`.
- Result rows have NDA badges, an excerpt, the source `path`, and a `file://` link opening the hit in the user's registered Markdown editor.
- Sidebar nav grows a "Search HM" entry between Today and Projects. Cmd-K command palette as a global trigger is the deferred v1.5 polish item.

### `/update-knowledge` — `/partner-knowledge/[slug]` editor (6662745)

- Smithers-native editor replacing the previous "open the file via `file://`" round-trip. Two-pane: body textarea + preview toggle (matches the weekly-update + draft editor pattern). Frontmatter is shown read-only above the body so the user can see what's preserved across save.
- `loadPartnerKnowledgeAction` reads the HM file via direct fs read (preserves the raw frontmatter via `gray-matter`); `savePartnerKnowledgeAction` merges existing + caller-provided frontmatter, stamps `updated` to today (matching the `/update-knowledge` skill's promise), writes via HM MCP `writePartnerFile`, and commits.
- `PartnerCard` on the project workbench grows an "Edit here" link next to the existing "Open in editor" link — the in-app editor is the default; the `file://` link stays for users who'd rather edit in their own setup.
- v1 deliberately body-only. Structured frontmatter fields stay editable via the existing brief wizard / project-metadata modal; a dedicated frontmatter form here is a follow-up.

## Just completed (2026-05-28 PM — WU3 weekly-update learn loop + Live Activity feed cleanup)

### Weekly-update learn-from-archives loop (1408ac5)

Closes the asymmetry where draft edits flowed back into `my-voice/` but weekly-update edits did not. Every weekly-update save that diverges from the AI's first pass now kicks off a fire-and-forget learn pass that compares the snapshot vs the user's final and appends learned patterns to a new `my-voice/WEEKLY_UPDATE_STYLE.md`.

- **Vault snapshot mechanism**: `WeeklyUpdateFrontmatter` grows `original_body`; `saveWeeklyUpdate` accepts it with `string=overwrite / null=clear / undefined=preserve` semantics so the snapshot survives subsequent edits. New `listWeeklyUpdatesWithDiffs(limit)` returns the N most recent files where `original_body` is set AND differs from the body — the learn loop only learns from real edits.
- **New voice file**: `WEEKLY_UPDATE_STYLE.md` added to `MY_VOICE_FILES`; `loadStyleReference` picks it up automatically since it iterates the registry. The `learnStyleFromArchives` system-prompt routing rule now sends `weekly-update` channel patterns to that file (decoupled from `INTERNAL_STYLE_GUIDE.md`, which still owns p2 channel patterns).
- **Wire-up**: `/api/learn-from-weekly-archives` mirrors the drafts route but pulls samples via `listWeeklyUpdatesWithDiffs` and tags `channel="weekly-update"`. Editor tracks the AI snapshot (initialized from frontmatter, refreshed on Regenerate, passed through `saveWeeklyUpdateAction` on save) and fires the learn route afterward when the body diverged. Small italic hint near Save surfaces what's happening.

### Live Activity feed source cleanup (7062494, 7bacf07, 393347d, 1538a03)

Debbie Millman workbench triggered a multi-pass investigation that exposed three independent gaps:

- **GitHub URL form** (7062494) — `github_repo` frontmatter was historically stored as either `owner/repo` or the full `https://github.com/owner/repo` URL. The activity fetcher split on `/` expecting bare slug; the URL form produced `['https:', '']` and every github task failed. New `normalizeGithubRepo` accepts either form across all four call sites.
- **Linear auth** (393347d) — context-a8c returned `"Please connect your Linear account at https://mc.a8c.com/ai/context-a8c/"` as plain text which `stdio-mcp` was silently converting to null. Now detects that exact pattern and throws so `runIsolated` surfaces it as a visible degraded-state notice instead of an empty panel. Also: `state: "all"` → `state: "OPEN"` for context-a8c-github/issues (provider only accepts uppercase OPEN / CLOSED).
- **P2 removed entirely** (1538a03) — context-a8c's `wpcom` provider doesn't expose per-post comments (probed: `user-profile / posts-text / reader / ...` — no comments tool). Public WP.com REST 401s on internal P2s like `wpspecialprojectsp2`. Cut the dead branch instead of leaving a permanently-zero chip: dropped `fetchP2Comments` + helpers, `p2_url` field from `ProjectActivityRefs`, `"p2"` from `ActivitySourceFilter`, the P2 chip from the workbench's configured sources list, and the mock-transport seed. `Project.p2_url` stays on the vault type for the workbench's "View P2 post" link.

### Earlier 2026-05-28 — /settings top-tab refactor + brief path fallback + Skills registry + brief generation workbench affordance

### Generate-brief workbench affordance via runtime skill loader (9039c16)

Full end-to-end `/create-brief` integration following Option 3 (the runtime-loaded approach): Smithers loads the skill's SKILL.md + declared dependency files from Hive Mind at runtime and runs the prompt directly via Claude, so HM stays the source of truth while Smithers provides the native one-button workflow.

**Foundation (reusable for `/project-handoff`, `/update-knowledge` later):**
- `@smithers/vault` gains `getHiveMindSkillContent(slug)` returning `{ skill, system_prompt, files }`. `files` is keyed by HM-root-relative path and populated from the skill's frontmatter `dependencies` list.
- `HiveMindSkill` grows `dependencies: string[]`, parsed from the new SKILL.md frontmatter field.
- New `run-skill` agent in `packages/agents/`: framing wrapper that takes the skill body as system prompt and a structured user message with all pre-gathered inputs + dependency-file contents. Returns `{ markdown, questions }` — questions for things the skill would normally ask the user about.

**Brief-specific wiring:**
- `generateProjectBriefAction` gathers transcripts + Discovery Doc + registrar/dns + project/partner context, calls `runHiveMindSkill`, persists inputs (discovery_doc_url via `updateProjectInfo`; registrar/dns via new `buildPartnerKnowledgeFrontmatterUpdate` + `writePartnerFile`).
- `saveProjectBriefAction` writes `brief.md` to HM via `writeProjectFile` + commit, revalidates the workbench.
- `BriefGeneratorDialog`: 4-section input phase (transcripts multi-select, Discovery Doc url/paste toggle, registrar + dns inputs) → generating spinner → review phase with editable markdown + preview toggle + flagged-questions banner → "Save to Hive Mind."
- `GenerateBriefButton` slots into both empty + populated states of `ProjectBriefSection`.

**Hive Mind side (same-day):**
- `.claude/skills/create-brief/SKILL.md` gains `dependencies:` frontmatter listing `templates/project-brief.md`, `knowledge/integrations.md`, `temp/brief-final-partner.md`.
- `templates/partner-knowledge.md` gets `domain_registrar` + `dns_provider` scaffolding.
- `templates/project-info.md` gets `discovery_doc_url` scaffolding.

### Brief path fallback + HM Skills registry (11f4dde)

Two unblockers, both surfacing content that already existed in the HM clone but Smithers couldn't see.

- **Brief path fallback** — `getHiveMindBrief` tries three paths in order: (1) canonical `briefs/project-brief.md`, (2) `info.md` frontmatter `brief_path` override (path-relative, sanity-checked to refuse `../` and absolute paths), (3) `brief.md` at the project root. Returns `{ google_doc_url, body, source_path }`; the workbench's "Edit brief" link now uses `source_path` so the `file://` URL points at the actual file rather than the canonical one. Fixes Body Dao showing the "No brief yet" empty state when a brief exists.
- **HM Skills registry** — new `listHiveMindSkills` helper scans `<hive_mind>/.claude/skills/*/SKILL.md` and parses each one's frontmatter (`name`, `description`, `allowed-tools`, `user-invocable`) into a `HiveMindSkill[]`. New `SkillsRegistryCard` renders each entry with description + tools + a link to its `SKILL.md`. Replaces the placeholder in `/settings → Skills` — currently shows all 10 skills in Team51-Hive-Mind. v1 is read-only; invocation from Smithers is the next slice (see PLAN.md project-briefs item).

### `/settings` top-tab refactor (cee4699)

Replaces the previous-day's left-rail-with-scroll-spy approach with a top tab strip that swaps the visible section. Same five sections; different control affordance.

- **Underline tab strip** at the top, click swaps the visible section. Only the active section renders to the visible DOM (the others sit in the RSC payload so tab switches are instant client-side, no server roundtrip).
- **URL state via `?tab=<id>`** (not hash) so deep links survive Next's SSR path and shared URLs / browser back-forward work. Bogus tab ids fall through to the default (Workflow) rather than 404.
- **Removed** `SettingsLayout` + `SettingsNav` (left-rail shell + IntersectionObserver scroll-spy from 2026-05-27). `SettingsSection` stays — each tab still benefits from its heading + description block. `SettingsTabs` (new) is the only nav component now.

## Previously (2026-05-27 — three scheduler jobs + /settings long-scroll attempt)

### `/settings` long-scroll page with sticky left-rail nav (b433976, superseded same-day by cee4699)

First attempt at the /settings redesign — left-rail nav with scroll-spy, all sections visible in one long page. User feedback: position was wrong; preferred swap-content tabs over scroll-everything. Replaced 2026-05-28 by cee4699 (see above). The Setup / Diagnostics / Skills / About section split + the SettingsSetupGroup wrapper sharing `SetupStatus` across the four /setup cards both carried forward to the tab refactor.

### Ping monitor + Fathom sync + Hive Mind sync (c7e0f12)

Closes the four-job scheduler roadmap from PLAN.md. Each new job follows the daily-briefing template (config opts in → `instrumentation-node` registers a hand-rolled timer → `/api/jobs/<name>` wraps the work for manual + cron + launchd triggers).

- **Ping monitor** (`schedule.ping_monitor.{enabled, interval_minutes}`, default 15 min) — reruns `recomputeActioned` against the current `listPings` feed and writes verdicts to the `ping_actioned` cache. Makes the manual Refresh button on `/today` obsolete when enabled.
- **Fathom sync** (`schedule.fathom_sync.*`, default 60 min) — warms the recordings cache via `mcp.fathom.listRecordings` so `/calls` + Recent Calls on `/today` surface new meetings without an explicit fetch.
- **Hive Mind sync** (`schedule.hive_mind_sync.*`, default 30 min) — runs `git pull --ff-only` against `cfg.paths.hive_mind` via `child_process`. Bails on a dirty working tree (logs "skipped" rather than fighting conflicts).

Wiring:
- New `lib/server/scheduler-jobs.ts` owns the three helpers. Each catches errors and returns `{ ok, summary | error, duration_ms }` — never throws, so a flaky MCP doesn't kill the cron.
- `instrumentation-node.ts` gains `scheduleInterval` (setTimeout chain so an overrunning job doesn't pile up) alongside the existing `scheduleDaily`, and registers each job per its config.
- Generic `IntervalJobCard` component instantiated three times in `/settings` (enable toggle, interval input, Run now button with live result display).
- `updateIntervalJobAction` in `settings/actions.ts` patches one job at a time; non-positive intervals are rejected.
- Three launchd plist templates in `scripts/launchd/` for firing each job via curl when `pnpm dev` isn't running.

Smoke-verified live: `/api/jobs/ping-monitor` → "no pings to check" (matches `/today` Inbox-zero state), `/api/jobs/fathom-sync` → "fetched 6 recording(s)" in ~2s, `/api/jobs/hive-mind-sync` → "already up to date" in ~2s.

## Previously (2026-05-26 — migration finish, handoff readiness, /agendas editor, Zendesk summary, project hardening, settings + scheduler)

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
2. **Ask Smithers → full AI agent** — newly added to PLAN.md. The palette ships today as a one-shot interpreter; the v2 is a real conversational agent with tool use, multi-turn, and broader vault read+write surface.
3. **Job Context handbook ingest** — newly added to PLAN.md. Use the public team handbook at https://specialprojects.automattic.com/project-handbook/ to enrich `my-voice/JOB_CONTEXT.md` so partner-safe voice grounding gets the team's documented norms baked in.
4. **Claude API usage card on `/settings`** — newly added to PLAN.md. Tokens + cost telemetry per agent, with a daily/weekly roll-up at the bottom of Settings.
5. **P2 integration re-evaluation** — newly added to PLAN.md. ContextA8C's wpcom provider may have grown comment-fetch tooling since the 2026-05-28 cut; re-probe and rewire if so.
6. **Personal Digest (v2)** — weekly highlight prompt + personal development tracker. Needs a design conversation before scoping.
7. **Project briefs — attach affordance + skill integration** — discovered while reviewing Body Dao (brief lives at `brief.md`, helper reads `briefs/project-brief.md`). PLAN.md captures the attach UX + `/create-brief` skill integration questions.
8. **Learning queue drain** — last scheduler job from the original roadmap. Only matters once `/api/learn-from-archive` moves from fire-and-forget to a real queue; out of scope until that happens. (Daily briefing + ping monitor + Fathom sync + Hive Mind sync all shipped.)
9. **`/today` view focus** — design discussion needed; queued in PLAN.md. Polish items (day-specific banners, AFK / weekend / no-data states) plus open questions about opinionated section visibility, "what changed since you last opened this," calendar integration surface, For-You-Today confidence.
10. **H6 — workbench Pinned context card** — manage pins outside of a draft flow.
11. **`/weekly-updates/[YYYY-WN]` editor** — stub.
12. **Remaining AI affordances** — Find related context. (Summarize Zendesk thread shipped 2026-05-26; @handle verification shipped 2026-06-02 as `HandleCheckBanner`.)
13. **Bell icon + unresolved-issues count** — vault-watcher events.
14. **Auto-draft nudge when follow-up crosses escalate threshold** — the thresholds are now user-configurable; the next slice is wiring the auto-draft trigger.

## Recent decisions (with the why)

- **Ask Smithers palette is a single global overlay, not a route** (2026-06-02 PM) — mounted in `app/layout.tsx` so Cmd-K works on every page without route-level wiring. The standalone `/search` page was removed in the same commit because folding it into the palette eliminates a redundant surface. Trade: the overlay's state machine got bigger (9 step kinds incl. AI confirm) but every consumer benefits from one keyboard shortcut and one results panel.
- **LLM dispatcher interprets but never writes** (2026-06-02 PM) — `interpret-palette-query` returns a structured intent + confirmation message; the palette runs the same server actions that the structured catalog uses to mutate state. Single source of truth for writes; the agent's job is to map free-form English onto the existing action surface, not to invent new ones. Confidence < 0.5 routes to an error state rather than silently picking the best guess — wrong-but-confident is worse than asking the user to refine.
- **Palette index keeps a 5-min in-memory cache on the server side** (2026-06-02 PM) — mashing Cmd-K shouldn't re-hit the HM MCP. 5 min is short enough that vault edits show up within one palette open; longer would have meant the user thinks the index is stale. Client fetches once per session — Cmd-K-open is cheap, Cmd-K-open-after-fresh-edit gets the new state on the next page load.
- **HM sync rebases on divergence rather than failing** (2026-06-02) — Original `git pull --ff-only` would have rejected any state where local had its own commits ahead of remote (which Smithers creates routinely via Process Call, brief generation, project-handoff, etc.). Rebasing local commits onto the new remote handles the common case cleanly. Alternative considered: leave `--ff-only` and surface "your local is ahead, push first" as an error. Rejected because Smithers-authored commits should sync automatically — the whole point of the job is "I shouldn't have to think about HM git state." Dirty working tree still skips (different risk profile — uncommitted user work).
- **Handle map exposed via `/api/handle-map`, not a server action** (2026-06-02) — `HandleCheckBanner` is used in two different surfaces (weekly editor + AiDraftDialog) and may end up in more later. A plain HTTP endpoint means the client component is self-contained: any new page that drops in the banner gets the map without each page needing to plumb a server action through props. Trade: a tiny serialization cost per editor load vs. the wiring tax of threading the map through server actions on every consumer.
- **JOB_CONTEXT.md auto-managed block uses HTML comment markers, not full-section replace** (2026-05-28→06-02) — Each group's roster lives between `<!-- BEGIN matticspace-<slug> -->` / `<!-- END -->` markers inside the "Common collaborators" section. User-edited intro/outro prose outside the markers survives every sync. Alternative: replace the whole `## Common collaborators` section on each sync. Rejected because Katie's hand-curated narrative ("This list is illustrative...") would have been wiped. Markers let auto-sync coexist with user prose.
- **studio-51 added to default group slugs after smoke-test** (2026-06-02) — Christy Nyiri wasn't returning from `@christy` lookup because she's not in `team-51` or `team-51-contractors` — she's in `studio-51` (the creative arm: design + dev + disco balls). Took a probe of the search-groups tool to find this. The discovery prompted us to bump the roster sync default to three groups rather than two.
- **Handle check is surface-for-review, not auto-fix** (2026-06-02) — Per-suggestion "Apply" button rather than silent rewrite on save. Safer: auto-fix could mangle a deliberate `@partnername` that happens to match a T51 first name. Ambiguous matches (multiple people with the same first name) skip the Apply entirely and just list the options — user picks.
- **Skill dependencies live in SKILL.md frontmatter, not a Smithers-side registry** (2026-05-28) — Skills declare which files they read at runtime via a `dependencies:` YAML list. Smithers' `getHiveMindSkillContent` loads them. Alternative considered: hardcode per-skill in Smithers (`SKILL_DEPENDENCIES["create-brief"] = [...]`). Rejected because HM is the source of truth for skill metadata; embedding it in Smithers creates drift when the skill evolves. Trade: needs cross-repo coordination when adding a new dep, which is the right discipline anyway.
- **`run-skill` is a generic agent, not `generate-brief`** (2026-05-28) — Same agent handles `/project-handoff`, `/update-knowledge`, and any future skill that produces a single markdown artifact. The skill-specific shape is in the user prompt (gathered inputs + dependency files), not the agent code. Trade: one shared contract means brief-specific output schema validation isn't possible (output is "markdown string + question list" regardless of skill); skills that need richer structured output would warrant their own agent.
- **Brief wizard has explicit phases (inputs → generating → review → saving), not AiDraftDialog reuse** (2026-05-28) — AiDraftDialog would have lost the questions banner + the "back to inputs" navigation. The brief flow's review phase needs the questions list above the markdown so Katie sees what the skill flagged before saving. Custom dialog is ~250 lines but maps to the actual workflow.
- **Skill prompt wrapped with "all inputs pre-gathered" framing, not rewritten upstream** (2026-05-28) — `/create-brief`'s SKILL.md is written for interactive Claude Code ("Ask the user for…", "Stop and pause"). Rather than ask HM to rewrite the skill for batch mode, Smithers prepends a small framing note that tells the model "Skip any 'ask the user' steps — treat the inputs as provided. Surface unknowns under `questions`." Same approach will work for `/project-handoff` and `/update-knowledge` without HM skill changes.
- **Brief path lookup tries three paths, doesn't migrate data** (2026-05-28) — the canonical schema is `briefs/project-brief.md`, but zero partners in the current HM clone actually use it; everyone has `brief.md` at the project root. Migrating files would have been days of coordination across multiple TAMs. Code change makes Smithers tolerant instead. The `brief_path` frontmatter override exists for the rare case where a partner team wants their brief somewhere else explicitly.
- **Skills registry reads the HM `.claude/skills/` dir directly, not a Smithers-side config** (2026-05-28) — HM is the source of truth for which skills exist; replicating that into a Smithers config would create sync drift. The trade is that disabling individual skills from Smithers' UI isn't trivially possible (the registry is read-only); when that's wanted, we add a Smithers-side overlay rather than a parallel registry.
- **`/settings` uses top tabs that swap content, not a long-scroll page with left-rail nav** (2026-05-28) — left-rail-plus-scroll-spy shipped 2026-05-27 (b433976) and was reverted same day. Reason: tabs that hide non-active content give a clearer "single-purpose view per click" feel and avoid the scroll-spy timing tradeoffs entirely. Tab state lives in `?tab=<id>` (not URL hash) so deep links survive Next's SSR path.
- **All tab bodies render in the RSC payload, only one displays** (2026-05-28) — pre-rendered children mean client-side tab switches are instant (no server roundtrip). Trade: every page load pays for rendering all five sections' content. Acceptable because the sections are mostly small forms; if a section ever gets heavy, we move to route-based tabs (`/settings/<tab>`) for true lazy loading.
- **`/settings` and `/setup` share the four setup section components, not copies** (2026-05-27) — setup-wizard.tsx exports PathsSection / IdentitySection / ApiKeysSection / McpsSection; `/settings → Setup` renders them via a thin `SettingsSetupGroup` wrapper that holds the shared `SetupStatus` state. Duplicating these into a "/settings only" version would have created a long-term sync problem (every field added to /setup would need to be added to /settings).
- **`scheduleInterval` uses a `setTimeout` chain, not `setInterval`** (2026-05-27) — re-queues the next tick only after the current job's Promise settles. If an interval job ever runs longer than its cadence (e.g. Fathom sync stalls past 60 min), the next fire stacks naturally behind it instead of piling up.
- **Hive Mind sync bails on a dirty working tree** (2026-05-27) — `git status --porcelain` first; non-empty means uncommitted local changes, and the safe choice is to skip rather than try to rebase/merge unattended. Logs "skipped (dirty working tree)" so the user sees it in the schedule-card's Last-run line.
- **Job runner shape: `{ ok, summary | error, duration_ms }` returned, never thrown** (2026-05-27) — chosen so a flaky MCP can't kill the cron. The `instrumentation-node` wrapper logs the result regardless; the API route surfaces it to the UI via the Run-now button.
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
