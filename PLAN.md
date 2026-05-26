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

## Background job scheduling

**Deferred — target this week.** Will build after `/style-guide` + learning loop are working.

Scope: launchd plists + node-cron in-process for recurring jobs: briefing, ping monitor, Fathom sync, Hive Mind sync, and eventually learning queue drain. The `/api/learn-from-archive` lightweight approach is a sufficient stand-in until then — nothing needs rearchitecting when the scheduler arrives.

---

## `/today` v2 — remaining flex stages (T5, T6)

**T1 + T2 + T3 + T7 shipped 2026-05-08.** Scoring, velocity strip, 3-tier layout, per-section reorder/show-hide, and the Top-3 confidence gate are live. Stage 1 also covered the "Collapsible + reorderable sections on project pages" plan item via the same `useLayoutPrefs` + `SectionList` primitive.

**T4 (filter chips) reverted** — visual noise, and chips weren't actually filtering server-side (likely an RSC cache-busting issue with `router.replace` not invalidating data fetches under `dynamic = "force-dynamic"`). If filtering comes back, that's the area to investigate.

**T5 — Focus / Scan / Catchup mode switcher** and **T6 — per-day-of-week defaults** stay deferred until a real itch surfaces. The current flex (reorder + hide via Edit layout) covers most of the customization need; modes would be a further "save layout as named mode" layer on top.

---

## Weekly Updates — follow-ups

**WU1 + WU2 shipped 2026-05-08.** Two-pane editor + AI generator + free-form format template settings card are live.

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

## Project briefs — attach affordance + skill integration

Discovered while migrating Body Dao: a project brief exists in Hive-Mind at the project root (`brief.md`) but doesn't show in the Project brief card. The card reads from `briefs/project-brief.md` (the documented schema), so any brief saved at a different path is invisible.

Two questions to resolve before building:
- **Attach UI**: how does a user point Smithers at a brief that doesn't live at the canonical path? Options: link a file (path picker), set a frontmatter `brief_path` override, or move/rename the file to the canonical location.
- **Project brief skill**: how does `/create-brief` (the existing skill) interact with Smithers when generating a brief into Hive-Mind? Should Smithers offer a "Generate brief" button on the workbench that invokes the skill end-to-end (skill → write to canonical path → commit → render)?

## Projects screen — status filter + hide archived

Two related changes on `/projects`:
- **Filter chips by status** at the top of the list (active, paused, completed, archived).
- **Hide archived by default** — currently all statuses render together, which buries active work as the archive grows.

Implementation likely shares the same chip-based filter primitive considered (and reverted) on `/today` T4. If we re-attempt chips here, we need server-side filtering, not just visual hiding, so cache busting through `router.replace` is solved before shipping.

## Other deferred items

- **v1.5 Linear ↔ Hive Mind ↔ Smithers sync** — deeper field standardization. Deferred until user signals priority.
- **Change-project-kind wizard** — Team/Personal ↔ Partner copy/unlink flow. Preserves `project_id`.
- **`/agendas/[project]` editor** — currently a stub.
- **In-flight indicator on auto-learn-from-archive** — currently fire-and-forget with a success toast on completion. Plan called for a small "learning…" pill near the archive button until the toast fires; deferred as a polish item.
- **H6 — workbench "Pinned context" affordance** — a small card on the project page for managing pins outside of a draft flow. Pinning currently happens via the picker's "Pin permanently" checkbox.
- **Migration: Neighborhood Nip + Shareable to Hive-Mind** — both vault projects have `hive_mind_partner_slug` set but haven't actually pushed their Open Items / Zendesk metadata into HM. Plus the 9 reverse imports queued in the original Phase F (a8c-creators, awaken-the-world, etc.) — still pending.
- **More AI affordances** — Summarize Zendesk thread, Verify @handles before posting, Find related context. Each is a self-contained small slice.
