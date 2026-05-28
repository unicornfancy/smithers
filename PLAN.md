# PLAN.md — Smithers deferred work

_Living doc for features discussed but not yet built. Add entries here when scoping a session; move to STATE.md "In flight" when implementation starts._

---

## Settings page — remaining items

The call-transcript-prompt + follow-up automation cards shipped 2026-05-26. /settings reorg + tab-based nav shipped 2026-05-27→28. Skills registry v1 shipped 2026-05-28. Still deferred:
- **Future follow-up automations** — auto-draft a nudge when a follow-up crosses the escalate threshold. Settings already exposes the threshold day counts; the auto-draft trigger is the next slice.
- **About section** — version, repo link, README + ONBOARDING shortcuts, running model id. Low priority polish.

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

## Skill integration — remaining queue

`/create-brief` integration shipped 2026-05-28 via Option 3 (runtime skill loader + `run-skill` agent + brief wizard). The foundation is reusable; remaining skills follow the same pattern.

- **`/project-handoff`** — workbench affordance to generate a handoff report when passing a partner to another TAM. Same shape as brief: load the handoff skill's SKILL.md + dependencies, gather inputs (which project + recipient TAM + any hand-off notes), run via `runHiveMindSkill`, write the artifact to HM. Smaller than brief because the inputs are simpler.
- **`/update-knowledge`** — closes the read-only loop on partner-knowledge cards. Bigger UI lift than the other two (needs a real markdown editor for partner-knowledge.md). The brief wizard's partner-knowledge frontmatter writer is reusable for the metadata; the body editor is new work.
- **`/search-knowledge`** — global HM search via command palette (`Cmd-K`) or a `/search` page. Not a skill in the runtime-prompt sense; the HM MCP's `search-knowledge` tool already exists and Smithers just needs to call it + render results.

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
- **More AI affordances** — Verify @handles before posting, Find related context. Each is a self-contained small slice (Summarize Zendesk thread shipped 2026-05-26).
