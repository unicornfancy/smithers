# STATE.md — Smithers (snapshot)

_Updated 2026-05-04_

## Just completed

- **Drafts trio (8a92e71, b66aa77, 9fadc43)** — `/drafts/[id]` in-app editor (textarea + live Markdown preview, auto-save 1.5s, Cmd/Ctrl-S, archived = read-only) + "Save as draft" button on every `AiDraftDialog` that snapshots the AI's first pass to `original_body` in frontmatter + Archive button on the editor + `learn-style-from-archives` agent surfacing on `/drafts`.
  - Caveat: only tested with Chrome on dev server. Auto-save tested with bare-id (`local:Drafts/...`) drafts — UUID-id drafts not exercised yet but should round-trip via the same code.
  - Caveat: style-guide write path is **not built** — agent returns markdown, user pastes manually.
- **Call transcript pipeline (e2e4c87, 195ecfd, 2439141)** — Process button on every Recent Call row → fetch transcript → `analyze-call-transcript` agent → multi-section dialog (summary, action items with owner, follow-ups with rationale + due, decisions, key quotes). Per-section accept paths write into Open Items / `Follow-ups.md` / project body. "From this call" toolbar drafts a P2 post or recap message. Auto-saves analysis to `Call Notes/<date> - <title>.md`; re-running Process loads from disk.
  - Caveat: comments-derived "Recent activity" disclosure under each Zendesk row stays empty because the upstream `comments` tool returns "Tool not found". Code path is correct; data isn't reachable.
  - Caveat: `analyze-call-transcript` only verified on the seeded mock transcript. Live Fathom transcript fetch was broken until `143c9d2` (recording_id type coercion); not yet visually confirmed end-to-end against a real call.
- **AI affordances on workbench (5c04c87, f888ced, 4436e41)** — `For You Today` panel runs `suggest-next-step` on demand; `Draft nudge` button on each active follow-up; `Draft reply` button on each active Zendesk row.
  - Caveat: Zendesk reply context is subject-only because `comments` is broken; agent leans on subject + style guide and tends to draft clarifying-question replies when it lacks specifics.
- **Call transcript chat + regenerate instructions (this session)** — "Chat about this call" multi-turn panel added to Process Call dialog (transcript as context, save conversation to Call Notes file as `## Chat` section). "Additional instructions for this run" textarea added near Re-analyze button for one-off prompt overrides.
  - Caveat: `chatAboutCallAction` uses the Anthropic SDK directly in actions.ts (not a structured agent) — transcript is passed as full context on every turn.
  - Caveat: not yet visually tested end-to-end against a live call.
- **Task priority + due date + GitHub issue creation (this session)** — Inline bracket notation `[high]`/`[medium]`/`[low]` and `[YYYY-MM-DD]` at end of task lines. Parser strips markers from display text and task_id hash for stable ids. Priority badge (rose/amber/slate) and due date label (amber warning if past) on task rows. GitHub icon button on open tasks (when `github_repo` set) opens pre-filled new-issue tab. `analyze-call-transcript` agent now suggests priority + due_date per action item; Process Call dialog shows editable pre-fills before accepting.
- **Convert between To-dos and Follow-ups + edit follow-ups inline (this session)** — "Convert to follow-up" button on open task rows (dialog: sent-to, sent date, follow-by date → removes task, adds follow-up). "Convert to to-do" button on active follow-up rows (immediate: resolves follow-up, appends task checkbox). Edit button on every active row of `/follow-ups` page with inline form (task text, sent-to, dates, status).
  - Note: `updateFollowUp` looks up rows by content-derived id. Editing task text changes the id for subsequent lookups — documented in the helper.
- **GitHub Issues in activity feed + mention pings (this session)** — GitHub issues (open/closed) added to project workbench Live Activity feed via ContextA8C `github/issues` with REST API fallback. GitHub mention pings for `unicornfancy` surfaced on `/today` Pings panel by querying open issues where user is mentioned. Both degrade gracefully when GITHUB_TOKEN absent.

## In flight

- **Style-guide write path** — `learn-style-from-archives` produces a markdown block; no helper yet to append it into `style-guide.md`. User opted to leave style-guide untouched for now.
- **Background job scheduling** — plan calls for launchd plists + node-cron in-process for briefing / ping monitor / Fathom sync / Hive Mind sync. None built. Manual rerun buttons exist for some.
- **Save-as-draft for legacy paths** — only AI dialogs offer "Save as draft". Hand-authoring a draft from the workbench (no AI involved) goes through Obsidian.

## Open TODOs

In rough priority order based on user signal this week:

1. **More AI affordances** — punch-list candidates: Summarize Zendesk thread, Verify @handles before posting, Find related context.
2. **Project metadata modal: Linear sync probe** — `getLinearProjectMetadata` calls `tool: "project"`. Not yet verified live; if upstream uses a different name, modal sidebar shows "couldn't load Linear data". Same iteration pattern as Zendesk.
3. **`/today` polish** — day-specific banners (Mon Weekly Update, Fri reflection), AFK state, weekend / new-user / no-data states. Dashboard you see every morning; high-frequency value.
4. ~~**Edit existing follow-ups inline**~~ — shipped this session.
5. **Wire GITHUB_TOKEN** — add to `.env.local` to enable GitHub Issues in activity feed and mention pings on /today.
5. **`/agendas/[project]` editor** — currently a 23-line stub.
6. **`/style-guide` editor** — stub. Pair with style-guide write path so `learn-style-from-archives` can append directly.
7. **`/weekly-updates/[YYYY-WN]` editor** — two-column markdown + sources sidebar; stub.
8. **Project metadata: change-kind wizard** — Team/Personal → Partner copy-to-Hive-Mind; Partner → Team/Personal Hive Mind PR. Preserves `project_id`.
9. **Bell icon + unresolved-issues count** in app header — vault-watcher Class A/B/C events.
10. **`[View source]` / Open as markdown** escape-hatch button on every page.
11. **v1.5 Linear ↔ Hive Mind ↔ Smithers sync** — deeper field standardization. Captured in agent memory; out of scope until user signals.

## Recent decisions (with the why)

- **Persist Zendesk subject + status in frontmatter at attach time** — upstream MCP only exposes `search`; `ticket`/`tickets`/`get_ticket`/`comments` all return "Tool not found". The `id:<n>` search filter is unreliable (returns 0 results or wrong tickets). Workaround: capture rich data when the user attaches via the search modal, render the panel from frontmatter, never per-render upstream lookup.
- **Merged Follow-ups card into Zendesk Threads** — Katie said all her follow-ups tie to threads in practice. Hard merge with an "Unattributed" bucket at the bottom for follow-ups whose task text doesn't mention `#<id>`.
- **`zendesk_search_terms` is user-curated, not derived** — partner display name and deslug-with-spaces aren't enough to surface every attached ticket via search. Settings dialog persists user-typed terms (typically partner contact emails) which Refresh fans out.
- **base64url for draft URLs** — Next `[id]` doesn't accept slashes even URL-encoded; legacy `local:Drafts/...` ids contain slashes. `apps/web/lib/draft-id-url.ts` is the codec.
- **DraftEditor is a textarea, not CodeMirror** — Katie accepted the lighter scope. Swap later if syntax highlighting becomes load-bearing.
- **Don't auto-write to `style-guide.md` after learn-style** — keep the user in the loop; silent appends without review feel wrong.
- **One agent per file, no shared "agent base class"** — system prompt + JSON schema + validate fn co-located. Easier to read, harder to overgeneralize.
- **Stay on ContextA8C as the single MCP front door** for now — direct Linear MCP would be richer but adds a parallel client. v1.5 territory.
- **`maxItems` is forbidden in agent schemas** — Anthropic's structured-output validator rejects it. Use prompt + post-validation `.slice(0, N)`.
- **Change-project-kind: Partner → Team/Personal unlinks, doesn't delete** — the Hive Mind copy stays in place; Smithers just stops treating the local project as partner-kind. Reversible.

## Open questions

- The `learn-style-from-archives` button is on `/drafts`. Should it also live on a future `/style-guide` page? ?
- For Linear sync (v1.5): canonical source-of-truth split. Pull-from-Linear (Linear authoritative for state/target_date), push-to-Linear (Smithers authoritative for partner-status), or bidirectional with conflict resolution? Decision deferred until the slice starts.
- The "From this call" P2-update + recap-message drafts always re-fetch the transcript even when the call analysis was loaded from saved notes. Should the cached file also stash the transcript so the side-drafts skip the round-trip? ?

## Known issues / works-but-feels-wrong

- **ContextA8C `comments` tool not found** — Live Activity Zendesk-comments path returns 0 events; Threads panel "Recent activity" disclosures are always empty. Silent degradation; UI doesn't say "comments unavailable upstream". Will resolve when the upstream MCP exposes the right tool name.
- **`gray-matter` round-trip rewrites YAML** — re-saving frontmatter via `serializeMarkdown` can re-emit values with different quoting/ordering. Not a correctness bug, but `git diff` shows noise on idempotent re-saves.
- **`router.refresh()` after server actions has a brief flash of stale data** — visible when attaching a Zendesk ticket from the modal; works but not fully smooth.
- **`Add N to Open Items` / `Add N to Follow-ups.md`** in the Process Call dialog don't disable when N=0. Click does nothing + toast says "no items selected"; should disable instead. ?
- **Anthropic session expiry** — periodic `MCP error -32603: Invalid or expired session` from ContextA8C. Caught and degraded per-call, but visible in dev server logs and intermittently surfaces empty states until re-auth.
- **No "saving" indicator on the in-app draft editor** beyond a small text status. Easy to miss. ?
- **Hive Mind partner profile** — `partnerProfile?.display_name` is often null in our test data, so `defaultSearchQuery` falls back to the partner slug (`the-pocket-nyc`), which is a poor Zendesk search term. The deslug-with-spaces hint is the workaround but the auto-fallback chain could be smarter. ?
- **`/today` not exercised this week** — every workbench-side change might have stale assumptions about vault data shapes (especially `zendesk_tickets` going from `string[]` → `ZendeskTicketRef[]`). Worth a smoke pass after the next session opens.
