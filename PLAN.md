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
