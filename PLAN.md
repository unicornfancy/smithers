# PLAN.md — Smithers deferred work

_Living doc for features discussed but not yet built. Add entries here when scoping a session; move to STATE.md "In flight" when implementation starts._

---

## Google Drive activity ingestion

**Status:** `google_drive_url` frontmatter field + header chip shipped 2026-06-17. Activity ingestion deferred.

**Why deferred:** Drive MCP wrappers (e.g. `@modelcontextprotocol/server-gdrive`) require a one-time Google Cloud / OAuth setup before they can be spawned as a subprocess. The setup is real:

1. Create a Google Cloud project
2. Enable the Drive API
3. Configure an OAuth consent screen (internal is fine)
4. Create an OAuth Client ID (Desktop App type)
5. Download the JSON keys
6. Run `npx -y @modelcontextprotocol/server-gdrive auth` to do the OAuth dance

**What lands when ready:** a `GoogleDriveClient` wrapper in `packages/mcp-client/src/google-drive/` modeled on the ContextA8C client. Method `searchFolderActivity(folderId, sinceTs)` calls the Drive `search` tool with `parentId = '<folderId>' and modifiedTime > '<sinceTs>'`, maps results to `ActivityEvent`, merges into Live Activity. Folder ID parsed from the project's `google_drive_url` (regex `/folders/([A-Za-z0-9_-]+)`).

**Trigger to revisit:** Katie completes the OAuth setup OR a simpler Drive integration (e.g. Workspace events, public folder RSS) becomes available.

## Settings page — remaining items

The call-transcript-prompt + follow-up automation cards shipped 2026-05-26. /settings reorg + tab-based nav shipped 2026-05-27→28. Skills registry v1 shipped 2026-05-28. About card shipped 2026-05-29. Still deferred:
- **Future follow-up automations** — auto-draft a nudge when a follow-up crosses the escalate threshold. Settings already exposes the threshold day counts; the auto-draft trigger is the next slice.
- **Signature aliases for the Zendesk author-name matcher** — the matcher in `lib/server/author-name-matcher.ts` reads `identity.name` and tries (a) full name anywhere, (b) first name in body tail. Covers ~90% of TAMs out of the box. Edges where it'd miss: nicknames (Robert → Bob), last-name-only sign-offs ("— Smith"), initials, unusual styles. Shape: add `identity.signature_aliases: string[]` config + a small "Signature aliases" input on `/setup` + `/settings → Identity`, one alias per line, tested same as the first-name tail fallback. ~30 lines total. Defer until a TAM actually trips on this — telling them "set your nickname as identity.name" is the workaround in the meantime.

## AFK — Linear-secondary-TAM lookup for per-project coverage override

`compose-afk-notes` already carries a `tam_coverage_override` slot per `AfkProjectSlice`; the AFK action just leaves it undefined so the form's global `coverage_handle` is used uniformly. To honor Katie's original ask that per-project coverage can come from Linear instead of the form default:

- Extend the Linear client with `getProjectMembers(projectId)` (Linear GraphQL exposes `project.members[]`).
- In `generateAfkPostAction`, when a project has `linear_project_id`, fetch members, filter for someone tagged "secondary TAM" (convention TBD — could be a Linear label, a description-line pattern, or "second lead"), and populate `tam_coverage_override` with the resolved handle.
- The agent prompt already uses the override when set (see the AFK "TAM Coverage" rules block).

Trigger to revisit: Katie decides how she wants secondary TAMs tagged in Linear.

## Kosh v2 gate handling — interactive auth passthrough

**Status shipped 2026-07-06:** structured gate detection + retry-with-Share-Link affordance on the run detail page. When Kosh's reachability check trips, Smithers parses the gate type from the subprocess's stdout (preferred: machine-readable `[SMITHERS_GATE:<type>]` marker Smithers injects into the prompt; fallback: regex over Kosh's free-form language), stores it in a new `failure_kind` column as `gated:coming-soon` / `:password` / `:private`, and the detail page renders a `QaGateFailedCard` with the Share Link explanation inline plus a pre-filled URL input for one-click retry.

**Deliberately not shipped: in-place resume.** Genuinely pausing the subprocess mid-run so the user can auth in the open browser and click Continue requires either (a) switching from `claude --print` to a headless interactive `claude` session Smithers pipes to/from over a socket, or (b) preserving Playwright browser state across separate `claude --print` invocations. (a) is a large rewrite; (b) needs Kosh-side cooperation (the browser is scoped to the subprocess today). The retry-with-Share-Link flow is more direct anyway — self-service, no waiting for the user to auth.

Revisit only if a TAM without Share Link access repeatedly needs to audit gated sites in situ, e.g. a partner-side flow where staging is password-only AND no share preview URL is available.

## team51 CLI — Terminal-launched flow (v2)

**Status shipped 2026-07-08:** subprocess-based version scrapped; new Terminal-launched flow ships in its place. Four workflows (`wpcom:create-site`, `pressable:create-site`, `pressable:clone-site`, `run-site-wp-cli-command`) all now compose their command from the Smithers form, drop the composed command into a Terminal window via AppleScript, and receive the log back via a one-time-token-authenticated postback endpoint. Post-success frontmatter write-back (`production_url` / `staging_url`) is a one-click button on the completed run's detail page.

**Follow-ups worth considering:**

- **Additional commands beyond the top-4.** Full CLI list is at `~/team51-cli/commands/`. Based on Katie's usage patterns, the next-most-useful are `pressable:add-collaborator`, `deployhq:create-project`, `github:create-repository`. Each is ~150 lines of dialog + action + a `Team51CommandSlug` extension. No changes needed to the runner — it's fully generic.
- **URL parsing patterns per command.** The current regexes in `parseTeam51ResultUrl` are best-effort against team51's actual output. When we ship additional create-* commands, we'll want to verify each command's real output format before adding its regex.
- **Live log streaming during the run.** The Terminal-launched design gives up in-Smithers live tail. If we ever want it, the script could POST log chunks periodically (say every 5 lines) to a `/api/team51/log-chunk` endpoint. Nice-to-have but not asked for.

## Release cadence — deferred decision

Considered switching the Update Smithers card to pull the latest git tag instead of `origin/main` so a mid-day broken push doesn't reach users. Katie decided to keep pushing to `main` and manually nudge TAMs to update at release checkpoints. Revisit when we have enough users that a bad main commit is genuinely disruptive.

## Background job scheduling — remaining jobs

Daily briefing, ping monitor, Fathom sync, and Hive Mind sync all shipped 2026-05-26→27. Remaining:
- **Learning queue drain** — when `/api/learn-from-archive` moves from fire-and-forget to a real queue, drain it in the background instead of awaiting on archive. Out of scope until the queue actually exists.
- **Auto-draft nudge when a follow-up crosses the escalate threshold** — the thresholds are now user-configurable (`stall_thresholds.*`); the next slice is wiring the auto-draft trigger. Distinct from scheduling but shares the "fire on a schedule" infrastructure.

---

## `/today` v2 — remaining flex stages (T5, T6)

**T1 + T2 + T3 + T7 shipped 2026-05-08.** Scoring, velocity strip, 3-tier layout, per-section reorder/show-hide, and the Top-3 confidence gate are live. Stage 1 also covered the "Collapsible + reorderable sections on project pages" plan item via the same `useLayoutPrefs` + `SectionList` primitive.

**T4 (filter chips) reverted** — visual noise, and chips weren't actually filtering server-side (likely an RSC cache-busting issue with `router.replace` not invalidating data fetches under `dynamic = "force-dynamic"`). If filtering comes back, that's the area to investigate.

**T5 — Focus / Scan / Catchup mode switcher** and **T6 — per-day-of-week defaults** stay deferred until a real itch surfaces. The current flex (reorder + hide via Edit layout) covers most of the customization need; modes would be a further "save layout as named mode" layer on top.

---

## Weekly Updates — follow-ups

**WU1 + WU2 shipped 2026-05-08. WU3 (learn-from-archives loop) shipped 2026-05-28.** Two-pane editor + AI generator + free-form format template settings card + edit-diff → `my-voice/WEEKLY_UPDATE_STYLE.md` learning loop are all live.

Possible follow-ups (none scoped, none scheduled):
- **One-click "Post as comment" to the team P2** — currently the user copies and pastes manually. Would require either a P2 provider in ContextA8C or direct WP.com REST `POST /comments` with auth.
- **Per-project facts table on the editor** — current Facts panel shows counts; a more detailed roll-up (each event with link) might help cross-checking.
- **Sticky "user notes for this run"** — currently per-generate; might be worth persisting a "next week pre-notes" file the user appends to throughout the week.

---

## Personal Digest (v2)

A weekly self-check surface that's about Katie/the user, not the work. Distinct from `/weekly-updates` (which goes to the team P2 and reports on partner projects). Two pieces:

- **Weekly highlight prompt** — once a week, asks "what's one thing worth remembering from this week?" Free-form answer persists to the vault (likely `Personal Digest/<YYYY-WNN>.md` or similar). No partner context, no agent rewriting — captured as-is.
- **Personal development tracker** — running surface for goals, skills being learned, things to revisit. Lightweight; probably a single file with the same Open Items pattern as agendas, or section-per-area.

Open questions for the design conversation:
- When does the highlight prompt fire? Friday afternoon? Monday on first dev-server load of the week? Banner on `/today` vs dedicated `/digest` page?
- How does this relate to (or stay separate from) weekly-updates? They're different audiences but might share a draft cycle.
- Does this connect to the existing learn-from-archives loop / style guide, or stay isolated?

Defer concrete design until weekly-updates settles and this can be properly scoped against it.

---

## Skill integration — queue closed 2026-05-29

`/create-brief` (2026-05-28), `/project-handoff` (2026-05-29 — workbench wizard via `WorkbenchHeader` "Handoff" button), `/search-knowledge` (2026-05-29 — `/search` page over the HM MCP tool with sidebar entry; the standalone `/search` page was removed 2026-06-02 PM when Ask Smithers absorbed search), and `/update-knowledge` (2026-05-29 — `/partner-knowledge/[slug]` two-pane editor accessed from the workbench `PartnerCard`'s "Edit here" link) are all live. Foundation is the runtime skill loader + `run-skill` agent + per-skill wizard pattern from 9039c16.

Remaining polish (none scheduled):
- **Cmd-K palette** — shipped 2026-06-02 PM as Ask Smithers. See section below.
- **Frontmatter editor on `/partner-knowledge/[slug]`** — v1 is body-only; structured fields stay editable via the brief wizard / project-metadata modal. A dedicated form here would let users update title / description / team / NDA flag without leaving the page.
- **`/update-knowledge` for project info.md** — same editor pattern as partner-knowledge; project info.md edits currently go through the brief wizard's persistence path.

## Ask Smithers — palette shipped 2026-06-02 PM (A + B + C)

Slices A (foundation + Navigation + Add task), B (View status / Add follow-up / Set status / Attach Zendesk / Mark task done / Resolve / Snooze), and C (LLM dispatcher + helpful text) all live. See STATE.md for what landed. Possible follow-ups (none scoped):

- **Param-edit on the AI confirm step** — currently the user sees the agent's interpretation as read-only dl pairs and can only Confirm/Cancel. A small "edit" affordance would let the user tweak `task_text` or `status` before running without round-tripping through a re-query.
- **Recent-query memory** — last N palette queries surfaced when the input is empty (instead of the default top-of-index list). LocalStorage; per-user.
- **Parametric parsing as a fast path before the LLM** — `add task to <project>: <text>` could route locally without an Anthropic round-trip. Worth doing only if Ask Smithers usage stays high and the LLM latency becomes the perceived bottleneck.

## Ask Smithers → full conversational AI agent (v2 of the palette)

The palette today is a one-shot interpreter: query → one structured intent → confirm. The next step is a real agent that the user can talk to.

Open scope, not yet designed:
- **Multi-turn conversation** — user asks "what's the status of body dao?", agent answers inline, user follows up with "ok mark the staging task done", agent confirms and runs. The conversation state lives in the palette overlay until dismissed (or persists if useful).
- **Broader tool surface** — beyond the 9 structured actions: search Hive Mind knowledge, summarize a thread, fetch a Zendesk ticket's latest comment, "what changed on this project this week," etc. Probably reuses the existing per-feature agents as tools the dispatcher can call.
- **Read vs write boundary** — read tools run silently; any mutation still requires a confirmation step. Don't auto-post is the load-bearing constraint here.
- **Surfaces**: keep Cmd-K as the entry, but also consider a dedicated `/ask` page for long-running conversations + a workbench-side variant that's project-scoped.

Needs a design conversation before scoping. Pre-reqs: better understanding of what queries Katie actually types into the v1 palette (could log Ask Smithers queries to a local SQLite table for analysis).

## Job Context — ingest the Special Projects handbook

The public team handbook at https://specialprojects.automattic.com/project-handbook/ is the canonical statement of how Team51 operates. Pulling its substance into `my-voice/JOB_CONTEXT.md` would give every voice-aware agent a stronger ground truth for partner-safe job context (current JOB_CONTEXT.md is hand-curated and partner-safe v1).

Open questions:
- **Scope of ingest** — full handbook? Per-section excerpts (Engagement / Onboarding / Working with Partners / Voice)? Probably curated chunks rather than dump.
- **Mechanism** — manual one-time copy + occasional refresh, or a small fetcher that pulls + diffs the handbook on a schedule like the matticspace roster sync? Schedule cadence is much slower (monthly?) since the handbook moves slowly.
- **Provenance markers** — auto-managed BEGIN/END blocks like the matticspace roster blocks, so user-curated additions to JOB_CONTEXT.md survive re-syncs.
- **Confidentiality** — the handbook is public, so ingest itself is safe. Worth flagging if any internal-only addenda are mixed in.

## Claude API usage card on `/settings`

A "Costs" card at the bottom of `/settings` showing token + cost telemetry across all Smithers agent runs. The `AgentResult` already carries `usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`; nothing persists it today.

Sketch:
- **Storage** — new SQLite table `agent_runs(id, agent, model, input_tokens, output_tokens, cache_creation, cache_read, cost_usd, started_at, duration_ms, ok)`. Append on every `runAgent` call (via a thin shim around the runner).
- **Cost model** — per-model price table loaded from a JSON constant; Opus 4.7 input/output rates. Cache tokens billed at the per-Anthropic rate (10x cheaper for reads).
- **Settings card** — at the bottom of `/settings → About` (or its own "Costs" tab if it grows). Roll-up: last 24h tokens + cost, last 7d, all-time. Per-agent breakdown table sortable by cost. CSV export button for accounting.
- **Optional later**: budget alert when daily spend exceeds a configurable threshold; per-agent cap.

## P2 integration — re-evaluate after ContextA8C updates (and explore WordPress.com MCP)

P2 was cut from the Live Activity feed on 2026-05-28 (1538a03) because ContextA8C's `wpcom` provider had no per-post comments tool and public WP.com REST 401'd on internal P2s like `wpspecialprojectsp2`. ContextA8C ships periodic updates; the provider may have grown comment-fetch tooling since. Separately, the WordPress.com MCP (the public/official one) is a second path that may give cleaner P2 access than ContextA8C's `wpcom` wrapper.

Two parallel paths to probe — pick whichever produces working comment + post access on internal P2s:

**Path A — Re-probe ContextA8C:**
- Run `mcp.contextA8C.loadProvider("wpcom")` and dump the tool list. Look for `posts-comments`, `post-comments`, `reader-comments`, or anything that takes a post URL + returns the thread.
- Check whether the existing `posts-text` / `reader` tools now handle internal P2s without 401ing (the original cut was driven by auth, not by missing tools alone).

**Path B — WordPress.com MCP:**
- Evaluate the WordPress.com MCP (the official one, not the ContextA8C wrapper) as a parallel transport. May expose richer P2-as-WP-site primitives — post comments, post bodies, search across a P2, user/author lookups — under proper a8c-internal auth instead of public REST.
- Check whether it co-exists with ContextA8C (e.g. `mcps.wpcom` as a new config block alongside `mcps.context_a8c`) or whether it replaces the `wpcom` provider entirely. Hive Mind's MCP wiring is the precedent for "additional MCP transport beside ContextA8C."
- Compare against ContextA8C `wpcom` on the same internal-P2 fixtures — which gives cleaner data, lower latency, fewer 401s, write capability.

**Either way:**
- If comment reads work: re-add the `fetchP2Comments` branch in the activity pipeline, the `p2_url` field on `ProjectActivityRefs`, the `"p2"` source filter, and the workbench's P2 chip. The mock transport seed will need a P2 sample too.
- If write tools exist (`create-comment`, `create-post`): the manual copy-paste step in the team weekly-update flow (see Weekly Updates follow-ups above) becomes a one-click "Post as comment to team P2" affordance.
- If neither path produces working access: leave the cut in place but timestamp the re-probe date so the next person doesn't re-investigate. Record which MCP failed and how.

## Hive Mind side — recommendations for v1.5 (not blocking)

Surfaced while building the brief integration:

- **Skill prompt phrasing** — `/create-brief`'s SKILL.md is written for interactive Claude Code ("Ask the user for…", "Stop and pause"). Smithers wraps it with a framing note that says "all inputs pre-gathered, skip the asks." Works fine, but if you ever want a cleaner skill, rewriting prompts as input-agnostic ("Read these inputs (provided below or fetched). If a required input is missing, list it under follow-up questions.") would let any runner consume them without the wrapper.
- **Brief output path canonicalization** — skill writes to `<project>/brief.md`; CLAUDE.md and Phase 1 docs originally said `briefs/project-brief.md`. Smithers fallback handles both today. A small HM migration would make the canonical path mean something.
- **Two more reusable skill frontmatter fields** that would help Smithers + future runners: `output_path` (where the artifact lands — e.g. `brief.md` for /create-brief) and `requires_partner: true` / `requires_project: true` (so the workbench can know whether a skill needs context before offering it).
- **`temp/brief-final-partner.md` location** — referenced in the skill as the canonical reference brief. The `temp/` parent suggests work-in-progress; moving to `references/` or `examples/` would be cleaner naming.

## Other deferred items

- **v1.5 Linear ↔ Hive Mind ↔ Smithers sync** — deeper field standardization. Deferred until user signals priority.
- **Change-project-kind wizard** — Team/Personal ↔ Partner copy/unlink flow. Preserves `project_id`.
- **In-flight indicator on auto-learn-from-archive** — currently fire-and-forget with a success toast on completion. Plan called for a small "learning…" pill near the archive button until the toast fires; deferred as a polish item.
- **H6 — workbench "Pinned context" affordance** — a small card on the project page for managing pins outside of a draft flow. Pinning currently happens via the picker's "Pin permanently" checkbox.
- **More AI affordances** — Find related context. Self-contained small slice. (Summarize Zendesk thread shipped 2026-05-26; @handle verification shipped 2026-06-02 as `HandleCheckBanner` in weekly editor + AiDraftDialog, backed by the Matticspace roster sync.)
