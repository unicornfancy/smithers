# CLAUDE.md — Smithers

## What this is

Smithers is **Katie McCanna**'s personal-assistant workbench. Katie is a TAM at Automattic Team51 working with WordPress.com partners. The form factor is a **local Next.js 15 app** (run via `pnpm dev`, opened at `http://localhost:3000`) that reads/writes Katie's existing Obsidian markdown vault and pulls live partner data from MCP servers (ContextA8C, Hive Mind, Fathom). Project-centric: every workbench page assembles partner/team/personal context from the vault plus live sources. **Markdown is the source of truth.** SQLite is cache + UI state only.

## Tech stack + structure

- **pnpm monorepo**: `apps/web` (Next 15 App Router, RSC by default) + `packages/{vault,mcp-client,agents,transcription,ui}`
- **TypeScript strict + `verbatimModuleSyntax`** everywhere
- **Tailwind v4** + **shadcn/ui** (new-york style, zinc base) in `apps/web/components/ui`
- **React 19** — Server Components by default; `"use client"` only when needed

Load-bearing or easy-to-misread files:

- `packages/vault/src/index.ts` — the `createVault(opts)` factory. **Every vault helper must be wired through here**: import, `Vault` interface entry, factory binding. Three places to update for each new helper.
- `apps/web/app/projects/[slug]/actions.ts` — single file housing every workbench server action. Inline non-exported helpers are fine; only `async` exported functions are server actions.
- `apps/web/app/projects/[slug]/page.tsx` — fans out parallel data fetches in one `Promise.all`. Threading new props through this file is half of every workbench slice.
- `packages/agents/src/runner.ts` — Claude SDK wrapper using `output_config.format: { type: "json_schema" }`. Required cast workaround at the bottom because the Anthropic SDK types don't yet cover this field.
- `packages/agents/src/agents/<name>.ts` — one file per agent: system prompt + JSON schema + `validate` fn. Pattern: read another existing agent before adding one.
- `packages/mcp-client/src/{context-a8c,fathom,hive-mind}/{real,mock}.ts` — every MCP transport has both shapes; mock is used in seed-data screenshots.
- `apps/web/lib/draft-id-url.ts` — base64url codec for draft ids in URLs. **Do not bypass this** (see Gotchas).

## How to run it

```
pnpm install
cp config.example.yaml config.local.yaml          # then edit paths.vault
echo "ANTHROPIC_API_KEY=sk-..." >> apps/web/.env.local   # Next reads from apps/web, NOT repo root
pnpm dev                                           # next dev on :3000
```

First-run authentication for live MCPs is OAuth-via-browser-popup; tokens cache at `~/.mcp-auth`. The dev server runs in another terminal — Katie keeps it running and watches its stdout when we instrument diagnostic logging.

Smoke (vault helpers): `npx tsx packages/vault/scripts/smoke-toggle.mjs` — covers every vault write helper. Add cases here for any new write path.

Typecheck: `pnpm --filter @smithers/<pkg> typecheck`. There is no test runner; smoke + typecheck + browser-curl is the loop.

## Conventions

- **Slice flow**: vault helper → server action → client component → smoke → commit. One commit per slice. Conventional-ish messages (`feat(workbench): …`, `fix(zendesk): …`).
- **Discriminated server-action results**: `{ ok: true, data: T } | { ok: false, reason: 'not-configured' | 'error' | …, message?: string }`. UI branches on `reason` to show setup CTA vs. error vs. retry.
- **Idempotent writes**: every helper returns `{ changed: boolean }` (or equivalent) and short-circuits on no-op.
- **Empty-string clears, undefined leaves alone** in `updateProjectFrontmatter`-style patches.
- **Atomic writes** via `writeFileAtomic` (temp + rename) — never `fs.writeFile` direct on vault files.
- **AI dialogs reuse `AiDraftDialog`** (editable body + optional subject + Copy + optional Save-as-draft). Don't build per-affordance dialogs.
- **Persist agent output to frontmatter when feasible** so renders read from disk, not upstream. See `zendesk_tickets`, Call Notes files.
- **Diagnostic logging is fine while iterating** — Katie expects it stripped before commit.
- **Don't write README/docs files unless asked.** Markdown comments in code stay terse: explain *why* (a non-obvious constraint), not *what*.
- **No emoji in code/UI** unless explicitly requested.

## Gotchas + landmines

**Anthropic structured-output schema:**
- `maxItems` is rejected (`400 invalid_request_error`). Use prompt instructions + a post-validation `.slice(0, N)` cap.
- The `output_config.format` field needs the cast in `runner.ts` — SDK types lag.

**ContextA8C MCP:**
- Tool names are **namespaced**: call `context-a8c-execute-tool`, not `execute-tool`. Same for `context-a8c-load-provider`.
- Zendesk provider only exposes `search`. `ticket`, `tickets`, `show_ticket`, `get_ticket`, `find_ticket`, `comments`, etc. all return `"Tool not found"`. Don't go fishing — we already probed.
- Zendesk search response uses **`ticket_id`** (not `id`) for the numeric id. Mapper accepts both.
- Zendesk `id:<n>` filter in search **does not work** — returns 0 or wrong tickets. The workaround is **persist subject + status into frontmatter at attach time** (see `addProjectZendeskTicket`); the panel reads from frontmatter, never from a per-render upstream lookup.
- ContextA8C sessions expire periodically (`MCP error -32603: Invalid or expired session`). Every callsite wraps in try/catch and degrades gracefully.

**Fathom MCP:**
- `get_meeting_transcript` requires `recording_id` as a **number**, not string. Coerce when all-digits; non-numeric share tokens go through `url` arg only.
- `list_meetings` returns plain-text bulleted markdown (not JSON). Custom line parser in `fathom/real.ts`.

**Next.js dynamic routes:**
- `[id]` is a single URL segment. URLs containing slashes — even percent-encoded `%2F` — won't match. Drafts that haven't been migrated to UUIDs use a `local:Drafts/<path>` fallback id with embedded slashes. We base64url-encode at link time and decode in the page (`lib/draft-id-url.ts`). Use this for any id that might contain reserved chars.
- `revalidatePath` inside a server action invalidates the server cache, but the client tree doesn't refresh unless the action runs inside `useTransition` and you call `router.refresh()` after. Every modal-action component does this.
- `<li>` cannot contain another `<li>` — produces a hydration mismatch error. Hit on Zendesk Threads (ThreadCard's `<li>` wrapping ZendeskRow's `<li>`). Inner row is now a `<div>`.
- `"use server"` files: only `async` exported functions are valid server actions. Inline non-exported helpers (sync or async) are fine.

**gray-matter quirks:**
- `serializeMarkdown` strips trailing whitespace and may re-emit YAML with different formatting on round-trip. Idempotent helpers can still produce diff-noise on re-save. Smokes that compare exact strings will be brittle here.
- Empty frontmatter writes pure content with no `---` block.

**Hive Mind:**
- Projects with `kind: "hive-mind"` refuse all vault write helpers (they throw early). Pause before any Hive Mind write — those go through a separate confirmation flow upstream.

## What NOT to do

- **Don't add CodeMirror or any heavy editor.** The draft editor is textarea + live `<Markdown>` preview. Katie accepted this scope.
- **Don't auto-post anywhere.** Every AI affordance produces a draft the user reviews. `Save as draft` writes to the vault; nothing sends.
- **Don't introduce a generic "frontmatter editor" abstraction.** Each form (project metadata modal, Zendesk search settings, attach modal) is intentionally bespoke. Generic editor was discussed and rejected.
- **Don't tightly couple vault types to mcp-client/agent types.** Vault has parallel shapes (e.g. `SavedCallAnalysis` mirrors `AnalyzeCallTranscriptOutput`); coercion happens at the action layer to keep the dep graph clean.
- **Don't pass partner *slug* as a Zendesk search hint.** Hyphens (`the-pocket-nyc`) are unreliable search terms. Use display name, deslug-with-spaces, or user-curated `zendesk_search_terms`.
- **Don't refactor `Process Call` to fetch the transcript before opening the dialog.** It needs to spin inside the dialog so the user sees progress — transcript + agent is multi-second.
- **Don't add multiple Anthropic models.** Stick with `claude-opus-4-7`. `effort` (low/medium/high/xhigh/max) is the tuning knob.

---

## Cuts (so you can put any back)

1. **A "what shipped this week" log** — full timeline of features (Open Items CRUD, Zendesk threads, project metadata modal, AI affordances, call transcript pipeline, drafts editor, etc.). Skipped because git log is authoritative.
2. **The pause-points list** from the previous CLAUDE.md (push to upstream, first vault writes against partner-kind, etc.). Skipped because those points haven't been hit lately and may be stale.
3. **A v1.5/v2 deferred-work section** (deeper Linear ↔ Hive Mind ↔ Smithers field standardization). Lives in the agent memory file already.
4. **Per-package `package.json` script inventory** — typecheck/lint commands per package. Skipped because `pnpm -r typecheck` covers it and a fresh agent can `cat package.json`.
5. **Specific style-guide rules from Katie's edits** (no apologetic openers, no "just circling back", etc.). Skipped because those will land in `style-guide.md` via the learn-style-from-archives loop, not in CLAUDE.md.
