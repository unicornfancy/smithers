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

## Other deferred items

- **Style-guide write path** — `learn-style-from-archives` produces markdown; no helper to append it into `style-guide.md` yet. User opted to paste manually for now.
- **Background job scheduling** — launchd plists + node-cron for briefing / ping monitor / Fathom sync / Hive Mind sync. Manual rerun buttons exist.
- **v1.5 Linear ↔ Hive Mind ↔ Smithers sync** — deeper field standardization. Deferred until user signals priority.
- **Change-project-kind wizard** — Team/Personal ↔ Partner copy/unlink flow. Preserves `project_id`.
- **`/agendas/[project]` editor** — currently a stub.
- **`/style-guide` editor** — stub.
- **`/weekly-updates/[YYYY-WN]` editor** — stub.
