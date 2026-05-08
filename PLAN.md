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

## `/today` v2

**Decided 2026-05-08.** Scope locked; ready to build in staged slices.

### Page model: 3-tier hierarchy
The page reorganizes around the three roles it plays for the user — triage / awareness / flex. Section visibility maps to a tier; each tier renders with its own visual weight.

```
HOT (top, prominent)
  - Top pings by importance score
  - "Moving fast" horizontal strip — top 5 projects by 7-day activity
ACTIVE (mid, default-expanded)
  - Stalls, all other pings, recent calls
  - LLM-curated top-3 (only when confidence ≥ threshold)
BACKGROUND (collapsed by default)
  - Stat cards, drafts in flight, realistic-shape
```

### Importance signal — hybrid scoring
Each ping gets a numeric score; top-N go to HOT.
- **+ priority project bonus** — ping is from a project with `priority: high` in Hive-Mind `info.md` (or vault project frontmatter when HM not linked). User tags the project once.
- **+ partner-contact bonus** — ping author email/handle appears in the project's `partner-knowledge.md` team contacts. Distinguishes external partner voices from internal noise.
- **+ LLM bonus (gated)** — `composeTopThree` agent's pick, only when confidence ≥ threshold. (Requires adding `confidence` to the agent's output schema.) Falls through to rules-only when confidence is low — addresses the long-running gripe that the LLM picks haven't been reliable.
- **+ small staleness tiebreaker** — items waiting > 5 days nudge upward, doesn't dominate.

### Velocity signal — "Moving fast" strip
- For each partner project, count activity events from `mcp.contextA8C.listProjectActivity` in the last 7 days (Slack messages, GitHub commits/PRs/issue comments, Linear updates, Zendesk comments). Sum across sources.
- Sort projects descending by event count; top 5 in a horizontal strip with name + count + click-through to workbench.

### Flex — staged rollout (NOT v1 in one shot)
User wants maximum flexibility, but shipping all of it together is too much surface to keep clean. Staged:
- **Stage 1**: section ordering + collapse (folds in the separate "Collapsible + reorderable sections" plan item)
- **Stage 2**: filter chips at top of the page — "Show only Slack/Zendesk/GitHub/Linear/P2" multi-select; "Pinned projects" toggle scopes the Hot strip
- **Stage 3**: Modes — Focus / Scan / Catchup, each storing its own section visibility + density. User toggles between via a small mode-switcher in the header.
- **Stage 4**: Per-day-of-week defaults — Monday auto-loads a "Weekly Update prep" mode, Friday loads "End-of-week reflection." Customizable per user.

### Persistence
- localStorage per-browser for v1 (no sync). Promote to disk in `paths.data/today-prefs.json` once we want cross-machine sync.
- Pinned projects (a `priority: high` flag) stored on project frontmatter — already shared across the app, not /today-only.

### Slices (build order)
- **T1** — backend signals: importance score + velocity event count helpers. Add `priority` field reader to vault project parser; add HM `info.md` priority lookup. Add a `getProjectActivityCounts(7d)` helper. No UI yet.
- **T2** — frontend: 3-tier layout with HOT (top pings + Moving fast strip), ACTIVE (existing cards in current order), BACKGROUND (collapsed-by-default cards). No flex yet.
- **T3** — Stage 1 of flex: section ordering + collapse persistence (localStorage). Drag handles via @dnd-kit OR up/down arrows in an "Edit layout" mode.
- **T4** — Stage 2 of flex: filter chips + pinned projects.
- **T5** — Stage 3 of flex: Focus/Scan/Catchup mode switcher.
- **T6** — Stage 4 of flex: per-day-of-week defaults with editable presets.
- **T7** — Add `confidence` to `composeTopThree` agent output; gate LLM picks behind threshold.

### Open follow-ups (not blocking)
- Calendar MCP integration ("what's on your schedule today") — separate plan item if/when we add it.
- "What changed since you last opened this" affordance — postponed; not in v2 scope.

---

## Collapsible + reorderable sections on project pages

**Deferred — needs design discussion.** (`/today` side handled by `/today` v2 above; this entry covers `/projects/[slug]`.)

Project workbenches carry many sections (Project Status, Project Log, Partner, Zendesk, Follow-ups, Call Transcripts, Drafts, Open Items, Pinned Context, Live Activity, etc.). They render in a fixed order with no per-user customization. Goal: let the user collapse sections they're ignoring and reorder the ones they care about. Same persistence layer + drag-and-drop primitive as `/today` Stage 1 — once that lands, this is mostly UI plumbing.

### Open questions
- **Persistence target.** localStorage (per-browser, no sync, simplest) vs a new file under `paths.data/` (per-user, syncs if the data dir is in the vault) vs vault frontmatter on a `_layout.md`. Probably localStorage for v1; promote to disk if it ever needs to survive a fresh checkout.
- **Per-page or per-project order?** `/today` is one ordering for all days. `/projects/[slug]` could be one global ordering OR per-project (some partners have rich Zendesk threads, others don't have any tickets, etc.). Per-page is simpler. Per-project is more flexible.
- **Default collapse heuristic.** Auto-collapse empty sections (e.g. no zendesk tickets → Zendesk panel collapsed by default)? Or honor explicit user choice and treat empty-section noise as a separate fix?
- **Drag-and-drop interaction.** A drag handle in each section header is the standard pattern. shadcn doesn't ship a DnD primitive — pulling in @dnd-kit (~10kB) is the usual choice. Or skip drag entirely and offer up/down arrows in an "Edit layout" mode.
- **Reset affordance.** "Restore default order" button somewhere when the user has reordered things and wants to start over.
- **Mobile.** Drag-and-drop on touch is finicky; up/down arrows degrade better. Smithers is desktop-first today but worth considering.

### Sketch (best guess at scope, not locked)
- A small `useLayoutPrefs("today" | "project")` hook that reads/writes localStorage, returns `{ order: string[]; collapsed: Set<string>; reorder, toggleCollapse, reset }`.
- Each section grows a `<SectionCard id="..." title="..." defaultCollapsed?={...}>` wrapper that hooks into the prefs.
- An "Edit layout" toggle in the page header that shows drag handles + a Reset button. Outside edit mode the section headers stay clean.

Worth doing after we've lived with the current pages a while longer — we'll know which sections we actually want to hide.

---

## Other deferred items

- **v1.5 Linear ↔ Hive Mind ↔ Smithers sync** — deeper field standardization. Deferred until user signals priority.
- **Change-project-kind wizard** — Team/Personal ↔ Partner copy/unlink flow. Preserves `project_id`.
- **`/agendas/[project]` editor** — currently a stub.
- **`/weekly-updates/[YYYY-WN]` editor** — stub.
- **In-flight indicator on auto-learn-from-archive** — currently fire-and-forget with a success toast on completion. Plan called for a small "learning…" pill near the archive button until the toast fires; deferred as a polish item.
- **Phase H follow-ups** — the suggestion engine (H5: scan recent project activity and pre-populate the picker with togglable suggestions) and the workbench "Pinned context" affordance (H6: a small card on the project page for managing pins outside of a draft flow) were scoped but deferred. Pinning currently happens via the picker's "Pin permanently" checkbox; suggestions section in the picker is currently empty.
