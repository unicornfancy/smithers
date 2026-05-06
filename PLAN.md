# PLAN.md — Smithers deferred work

_Living doc for features discussed but not yet built. Add entries here when scoping a session; move to STATE.md "In flight" when implementation starts._

---

## Settings page (`/settings`)

Not yet built. When it is, these features should live there:

### Call transcript prompt customization
- Allow the user to adjust the global system prompt used by `analyze-call-transcript` (and the new chat-about-this-call feature) from a UI field in `/settings`, persisted to config or vault.
- The per-run "additional instructions" field in the Process Call regenerate flow feeds into that same prompt as a one-off override, layered on top of the global setting.

### Follow-up automation settings
- User-configurable thresholds for stall detection (nudge / escalate / force-decide day counts) — currently hard-coded in `config.yaml` stall_thresholds.
- Option to configure default follow-up fields pre-filled when converting a To-do → Follow-up (e.g. default follow_up_by window like "+14 days").
- Future: trigger automations (e.g. auto-draft nudge when a follow-up crosses escalate threshold).

---

## `/style-guide` page + automatic learning

**Decided 2026-05-05.** Scope and architecture locked.

### What it is
A multi-file editor for the my-voice skill framework at `paths.my_voice` (config key, points at `/Users/katherinemccanna/my-voice/`). Not vault content — application config used across multiple AI tools.

### Page shape
- File picker (tabs or dropdown) across all 5 reference files — SKILL.md, PARTNER_COMMS.md, INTERNAL_STYLE_GUIDE.md, EXTERNAL_STYLE_GUIDE.md, REPORT_STRUCTURE.md — defaulting to SKILL.md
- Two-panel editor: textarea left, live markdown preview right, auto-save
- "Learn from archives" button as manual fallback trigger

### Automatic learning on archive
When a draft is archived, the client fires a non-blocking call to `/api/learn-from-archive` (no await — archive action completes immediately). The API route runs the learning agent and appends new learnings to the appropriate file. A small "learning…" indicator resolves to a toast when done.

**Routing:** the agent receives the list of all my-voice files and their purpose descriptions. It decides which file(s) to update based on draft type — Zendesk/partner email diffs → PARTNER_COMMS.md, voice/tone corrections → SKILL.md, weekly update corrections → INTERNAL_STYLE_GUIDE.md.

**Write format:** new learnings are appended as a datestamped section (`## Learnings from archives — YYYY-MM-DD`) to the appropriate file. Existing content is never rewritten. User edits manually via the editor to fold learnings into the main body when ready.

### Config
Add `paths.my_voice` to `config.yaml` schema and `config.example.yaml`. Thin read/write helpers in `apps/web/lib/server/my-voice.ts` — no vault involvement.

---

## Background job scheduling

**Deferred — target this week.** Will build after `/style-guide` + learning loop are working.

Scope: launchd plists + node-cron in-process for recurring jobs: briefing, ping monitor, Fathom sync, Hive Mind sync, and eventually learning queue drain. The `/api/learn-from-archive` lightweight approach is a sufficient stand-in until then — nothing needs rearchitecting when the scheduler arrives.

---

## `/setup` wizard

**Decided 2026-05-06.** Independent of all other phases — can run in any session.

First-run experience for new TAMs picking up Smithers (the project-handoff workflow). Configures:
- `config.local.yaml` paths (vault, hive_mind, my_voice)
- API keys in `apps/web/.env.local` (ANTHROPIC_API_KEY, LINEAR_API_KEY)
- MCP enable flags + first-run OAuth (ContextA8C, Fathom)
- Hive-Mind server build check (`<paths.hive_mind>/mcp/server/dist/index.js`)

Visitors with missing essential config get redirected to `/setup` automatically.

---

## Multi-source context for AI drafts

**Deferred — needs design discussion.**

When generating a draft (e.g. Zendesk reply), pull in context from another source — for example a recent GitHub comment on the same partner project, or notes from yesterday's call. Each agent currently reads one context source only.

Open questions: how to surface the picker (modal at draft time? per-affordance settings?), how the agent merges sources, what counts as "related context" (manual selection vs. heuristic by partner/timeframe).

---

## Slack thread context for partner projects

**Deferred — needs design discussion.**

Attach specific Slack threads (not whole channels) as context for projects, so AI agents can reference them. Smithers reads channels via ContextA8C activity feed today but doesn't pin threads.

Open questions: file shape (`slack-threads.md` in Hive-Mind?), MCP probe for thread fetch, UI for attaching threads to a project.

---

## Phase J: Fathom matching + `/calls` page

**Decided 2026-05-06.** Investigated and ready to build.

### Why
Recordings that don't include the project name in the meeting title silently drop out of the project workbench's Recent Calls list. Confirmed by probe: a 2026-05-05 call titled `"Automattic Special Projects - Katie McCanna (Martin Porter)"` was missed for the-pocket-nyc, but the trailing attendees segment of Fathom's `list_meetings` response includes `grant@thepocketnyc.com` — data the current parser at [packages/mcp-client/src/fathom/real.ts:158-166](packages/mcp-client/src/fathom/real.ts#L158-L166) explicitly throws away.

Same surface should also support the team-call workflow: when a recording isn't tied to any partner project (e.g. Katie note-taking on an internal team call), Smithers should still let her run the analyze-call agent and save notes — just without a project link.

### Scope (5 slices, build as 2 batches)

**Slice A — close the title-only-match gap:**
- **J1.** Preserve attendees on `CallRecordingRef` (string field; raw comma-separated as Fathom emits).
- **J2.** Include attendees in the `recordingMatchesProject` haystack. `haystack.includes("pocket")` matches `thepocketnyc.com` since "pocket" is a substring.

**Slice B — visibility + manual match + team-call notes:**
- **J3.** `fathom_search_terms?: string[]` on project frontmatter. User-curated escape hatch (mirrors `zendesk_search_terms`). Treated as additional haystack tokens.
- **J4.** `/calls` page. Full recording list, two sections:
  - **Matched**: collapsed by default, grouped by project, link to the project workbench
  - **Unmatched**: primary surface. Per-row "Match to project" affordance opens a project picker → appends the chosen partner name to that project's `fathom_search_terms` so future calls auto-match. Per-row "Process without project" affordance runs the analyze-call agent and saves notes to `Call Notes/` without a project link — covers the team-call note-taking case.
- **J5.** `/today` "Recent calls" panel (small): top ~5 recordings with unmatched ones flagged; click → `/calls`.

### Files (anticipated)
- `packages/mcp-client/src/types.ts` — extend `CallRecordingRef` (J1)
- `packages/mcp-client/src/fathom/real.ts` + `mock.ts` — parser change (J1)
- `apps/web/app/projects/[slug]/page.tsx` — `recordingMatchesProject` (J2)
- `packages/vault/src/types.ts` + `projects.ts` — `fathom_search_terms` field + patch support (J3)
- `apps/web/app/calls/page.tsx` + `actions.ts` (new) — full list (J4)
- `apps/web/app/today/page.tsx` — recent-calls panel (J5)

---

## Other deferred items

- **v1.5 Linear ↔ Hive Mind ↔ Smithers sync** — deeper field standardization. Deferred until user signals priority.
- **Change-project-kind wizard** — Team/Personal ↔ Partner copy/unlink flow. Preserves `project_id`.
- **`/agendas/[project]` editor** — currently a stub.
- **`/weekly-updates/[YYYY-WN]` editor** — stub.
