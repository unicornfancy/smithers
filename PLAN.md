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

## Phase H: Multi-source context for AI drafts (incl. Slack threads)

**Decided 2026-05-07.** Scope locked; ready to build.

### What it is
Every draft agent (`draft-zendesk-reply`, `compose-followup-nudge`, `compose-call-recap`, `draft-p2-update`, etc.) currently reads one context source. Phase H adds a curation step before the agent runs where the user can attach extra context items — Slack threads, Slack messages, GitHub PR/issue comments, other Zendesk tickets, recent call transcripts on the same project.

Slack-threads as a separate phase folds in here: a Slack thread is just one of the attachable types. Same for individual Slack messages (treated as a sub-type — single-message ref vs full-thread ref).

### Flow
1. User clicks a draft affordance.
2. Dialog opens with three stacked sections:
   - **Suggestions** — Smithers scans the last ~7 days of project activity (call transcripts, ContextA8C activity feed for Slack/GitHub/Zendesk) and surfaces 3–5 candidates as togglable rows. **Not auto-attached** — user explicitly opts each in.
   - **Manual attach** — URL paste field that resolves to a Slack thread / Slack message / GitHub issue or PR comment / other Zendesk ticket. Plus a picker for "this project's existing call transcripts."
   - **Pinned context** — items the project has pinned permanently (loaded from frontmatter). Pre-checked but the user can opt-out for this draft.
3. **"Generate" is disabled until the user has explicitly confirmed the context set** (either by attaching ≥1 item, or by clicking a "No extra context" checkbox). Prevents silent runs against stale defaults.
4. Agent runs with primary source + the curated `extra_context: ContextItem[]`.

### Source types (v1)
- `slack-thread` — full thread by Slack permalink
- `slack-message` — single message by Slack permalink
- `github-issue-comment` — comment or PR review by URL
- `call-transcript` — pick from project's existing transcripts
- `zendesk-ticket` — by ticket id (excluding the one being replied to, when applicable)

Each `ContextItem` carries `{ type, ref, label, body }` after resolution. Body is the fetched text fed to the agent; ref + label survive on disk if pinned.

### Pinning
- Stored on the project in **Hive-Mind**: new optional file type `pinned-context.md` in the project folder. Team-shareable; survives TAM handoff. Schema mirrors zendesk.md / follow-ups.md (frontmatter + a markdown table of pinned items). New schema entry needs to land in the Hive-Mind repo first (templates/, CONTRIBUTING.md, CI validation when present).
- Workbench grows a small "Pinned context" affordance — add/remove. Mirrors the existing zendesk-tickets / fathom_search_terms patterns: paste URL → resolve → save → MCP `write-project-file` + `commit`.

### Suggestion engine
- Reads ContextA8C activity feed (already used by `/today`'s Pings panel) filtered to the project — last 7 days, max 5.
- For call transcripts, query `getHiveMindCallTranscripts` for the project.
- Lightweight ranking: recency weighted, plus skip items the user has already attached/pinned.

### Slices
- **H0 — Hive-Mind `pinned-context.md` schema.** Add to `Team51-Hive-Mind`: template, CONTRIBUTING.md entry, CI validation, `/setup-integrations` skill scaffold. Lands as a separate Hive-Mind PR before Smithers slices depend on it.
- **H1 — `ContextItem` type + URL resolver server action** (Slack thread/message first, then GitHub, then Zendesk). One server action that takes a URL and returns a resolved `ContextItem` or an error.
- **H2 — Pinned context read + write helpers**. Vault helper to read `pinned-context.md` from Hive-Mind (mirrors `getHiveMindZendesk`). Server action to add/remove items via `writeProjectFile` + `commit`.
- **H3 — Draft context picker component**. Reusable client component used by the existing `AiDraftDialog`. Renders Suggestions + Manual + Pinned sections; gates the Generate button.
- **H4 — Agent input schema extension**. Each draft agent input grows `extra_context?: ContextItem[]`; user prompts append a `# Additional context` block per item.
- **H5 — Suggestion engine** — server-side recency lookup against ContextA8C + Hive-Mind transcripts.
- **H6 — Workbench "Pinned context" affordance** — small card to manage pins outside of a draft.
- **H7 — Roll out across all draft affordances**. After H3 lands on one or two, generalize.

---

## `/today` view focus

**Deferred — needs design discussion.**

The dashboard the user opens every morning. Currently shows: stat cards (projects / drafts / follow-ups / daily notes), For-You-Today (LLM-curated top-3), Stalls, Pings to Action, Recent Calls (just added), Realistic Shape. Functional but not yet shaped around the actual rhythm of the day.

### Polish items already on the radar
- **Day-specific banners** — Monday: Weekly Update prep. Friday: end-of-week reflection. Ad-hoc banners for known events (e.g. partner kickoff coming up).
- **AFK / weekend / new-user / no-data states** — currently a fairly empty page when there's nothing to show; needs better non-empty paths for weekends, first-launch, and days with no signal.
- **High-frequency value** — this is the page the user lives in; small UX wins compound.

### Open design questions
- Should Today be opinionated about which sections appear when (e.g. hide Pings on weekends, surface Drafts in flight on Monday morning)?
- Does it need a "what changed since you last opened this" affordance? Today is always-fresh; it doesn't currently differentiate "new since yesterday" from "still here from yesterday."
- Is the right surface for the "what's on my calendar today" hook (out-of-band integration with Calendar MCP) the Today page itself or a separate `/agenda`?
- For the LLM-curated For-You-Today — confidence has been low historically. Worth investigating whether it's because the agent doesn't have enough signal, or because the signal is noisy.

Probably needs an actual day or two of "what would make my morning better?" observation before shaping. Filed here so the Open TODOs list reflects that this is a real focus area, not a one-line polish item.

---

## Other deferred items

- **v1.5 Linear ↔ Hive Mind ↔ Smithers sync** — deeper field standardization. Deferred until user signals priority.
- **Change-project-kind wizard** — Team/Personal ↔ Partner copy/unlink flow. Preserves `project_id`.
- **`/agendas/[project]` editor** — currently a stub.
- **`/weekly-updates/[YYYY-WN]` editor** — stub.
- **In-flight indicator on auto-learn-from-archive** — currently fire-and-forget with a success toast on completion. Plan called for a small "learning…" pill near the archive button until the toast fires; deferred as a polish item.
