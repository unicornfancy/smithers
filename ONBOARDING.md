# ONBOARDING.md — Smithers

First-time setup for a new TAM picking Smithers up. The [`README.md`](README.md) covers what Smithers is and the 30-second quickstart; this doc is the longer walk through `/setup` plus what to do when steps don't behave.

If you only read one thing: **markdown is the source of truth, mock mode works for any MCP that isn't on yet, and you have to restart `pnpm dev` after any config or env change.**

---

## 0. Prereqs (one-time)

Verify each:

```bash
node --version    # need >= 20
pnpm --version    # need >= 9
```

If pnpm is missing: `npm install -g pnpm` or `corepack enable && corepack prepare pnpm@latest --activate`.

You also need:

- An **Anthropic API key** — get one at <https://console.anthropic.com/settings/keys>. Save it where you keep credentials; Smithers reads it from `apps/web/.env.local`.
- (Recommended) A local clone of **`a8cteam51/Team51-Hive-Mind`** somewhere convenient — e.g. `~/Team51-Hive-Mind`. Smithers reads partner project data from there.
- (Optional) A **Linear API key** for direct Linear writes (project status, sub-tasks, viewer-id ping filtering). Without it, ContextA8C still gives you read-only Linear data.

---

## 1. Clone + install Smithers

```bash
git clone https://github.com/unicornfancy/smithers.git ~/smithers
cd ~/smithers
pnpm install
```

If `pnpm install` fails on a package, the most common cause is a Node version mismatch. Re-check `node --version`.

---

## 2. (Recommended) Clone + build Hive Mind

Skip if you don't have access yet — Smithers degrades to mock partner data.

```bash
git clone https://github.com/a8cteam51/Team51-Hive-Mind.git ~/Team51-Hive-Mind
cd ~/Team51-Hive-Mind/mcp/server
npm install
npm run build      # produces dist/index.js
```

Smithers spawns this MCP server locally; if `dist/index.js` is missing, the Hive Mind transport falls back to mock. The setup wizard surfaces the build status.

---

## 3. Start the dev server

```bash
cd ~/smithers
pnpm dev
```

Watch its stdout — config and any startup errors print there. Open `http://localhost:3000/setup` in your browser. On a fresh clone, you'll see a yellow "Finish setup to use Smithers" banner listing what's missing.

> **Why not `/today`?** Without a configured vault, `/today` shows a "Vault not found" banner with a link back to `/setup`. The wizard is the entry point.

---

## 4. Set your paths

In the **Paths** card:

### Vault

A folder of markdown notes — Obsidian-compatible but not Obsidian-required. The expected layout (auto-created over time as you use Smithers):

```
<vault>/
├── Daily Notes/
├── Projects/
├── Drafts/
├── Call Notes/
├── Agendas/
├── Weekly Updates/
└── follow-ups.md
```

If you already use an Obsidian vault, point at it (`~/Documents/A8C Claude`-style paths are fine). If you don't, make an empty folder; Smithers will write into it.

After typing the path, click **Save**. The badge should flip to green **Found**. If it says:

- **Not set** — you saved an empty value; type the path and re-save.
- **Path not found** — the directory doesn't exist on disk at the resolved path (shown below the input). Double-check `ls <path>` in a terminal.
- **Not a directory** — the path resolved to a file. Re-enter pointing at the parent folder.

### Hive Mind

Path to your `Team51-Hive-Mind` clone (e.g. `~/Team51-Hive-Mind`). Required for real partner data. If you skipped step 2, leave blank — the Hive Mind toggle will stay off and partner workbenches show mock data.

### My Voice

Path to your `my-voice/` skill files (`SKILL.md`, `PARTNER_COMMS.md`, `INTERNAL_STYLE_GUIDE.md`, `EXTERNAL_STYLE_GUIDE.md`, `REPORT_STRUCTURE.md`). These feed AI draft tone via the `/style-guide` editor. Leave blank for now if you don't have them yet — agents fall back to the vault-root style guide.

---

## 5. Add your Anthropic API key

In the **API keys** card, paste your `sk-ant-…` key into **Anthropic API key** and click Save. The badge flips to green **Set**.

This writes to `apps/web/.env.local` (gitignored). **Not** to the repo-root `.env.local` — that file isn't read by Next.js for the web app. (This bit before; the wizard handles it for you.)

If you have a Linear personal API key, paste it into **Linear API key** the same way. Without it, Linear MCP calls fall back to mock data.

---

## 6. Turn on MCPs you want live

In the **MCP servers** card, enable the ones you want hitting real data:

- **ContextA8C** — Slack, GitHub, Linear, Zendesk, P2 read access. The first call will pop a browser tab for OAuth and cache the token at `~/.mcp-auth`. **Enable this.**
- **Hive Mind** — reads/writes partner project files in your local clone via the MCP server you built in step 2. The wizard shows a green "Server built and ready" badge when `mcp/server/dist/index.js` exists; an amber warning with the exact build command otherwise.
- **Fathom** — call recordings via `mcp-remote` to `api.fathom.ai`. OAuth pops on first call.

Toggles you leave off use mock data — the UI keeps working so you can explore the layout without all integrations live.

---

## 7. Restart the dev server

Smithers caches config and env vars at module load. Stop `pnpm dev` (Ctrl+C) and run it again. If you set Smithers up as a launchd agent (see `bin/smithers-server.sh`), use:

```bash
launchctl unload ~/Library/LaunchAgents/com.smithers.dev.plist
launchctl load   ~/Library/LaunchAgents/com.smithers.dev.plist
```

---

## 8. Visit `/today`

Open `http://localhost:3000/today`. Expected:

- **Header** says today's date.
- **HOT / ACTIVE / BACKGROUND** tiers — empty on a fresh vault until you have projects and pings.
- **Pings to Action** panel — populates from ContextA8C once OAuth completes. The first time you load `/today`, you'll see the OAuth popup if you didn't trigger it earlier.
- **Recent Calls** — populated by Fathom (if enabled).

If you see **"Vault not found"**, the vault path still isn't right. Click the link back to `/setup` and double-check.

If you see **"No projects yet"**, that's expected on an empty vault — Smithers has no projects until you create one. From the sidebar, **Projects → onboard** is the right entry point: it joins Linear projects + Hive Mind partners + vault scratchpads into one list with per-row Import / Connect / Set up actions.

---

## Troubleshooting common first-run errors

| Symptom | Likely cause | Fix |
|---|---|---|
| Wizard shows path as **Found** but `/today` says "Vault not found" | You saved the path but haven't restarted `pnpm dev`. Config is cached at module load. | Restart the server. |
| **"Not configured"** on Pings to Action after enabling ContextA8C | OAuth popup blocked, or you closed it before completing. | Reload `/today` to retrigger; allow popups for `localhost:3000`. |
| Hive Mind panel shows mock data even with MCP enabled | `mcp/server/dist/index.js` doesn't exist — the local server isn't built. | `cd ~/Team51-Hive-Mind/mcp/server && npm install && npm run build`, then restart `pnpm dev`. |
| `/today` shows "Claude not configured" on the Top 3 card | `ANTHROPIC_API_KEY` isn't in env. | Either you forgot to save it via `/setup`, or you saved it but didn't restart `pnpm dev`. Re-check via the wizard — the Anthropic row should show **Set**. |
| Linear inbox panel says "degraded" with a stale cache | ContextA8C session expired. | Reload the page. If persistent, restart `pnpm dev` to re-OAuth on next call. |
| `Cannot find module '@modelcontextprotocol/sdk'` in the browser console | Build cache out of sync after a dependency change. | `rm -rf apps/web/.next` then restart the server. |
| Setup wizard reports paths but `/today` still feels broken | The vault may be a valid directory but missing the expected subfolders (`Projects/`, `Daily Notes/`, etc.) | Create them as needed, or just start using Smithers — vault helpers create directories on first write. |

More diagnostic recipes in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

---

## Where things live

| Thing | Path |
|---|---|
| Local config (gitignored) | `~/smithers/config.local.yaml` |
| API keys (gitignored, **must be here**) | `~/smithers/apps/web/.env.local` |
| SQLite cache + logs | `~/.smithers/` |
| OAuth tokens | `~/.mcp-auth` |
| Vault | per `config.local.yaml` `paths.vault` |
| Hive Mind clone | per `config.local.yaml` `paths.hive_mind` |
| my-voice skill files | per `config.local.yaml` `paths.my_voice` |

---

## Gotchas to know up front

- **Mock mode is the safety net.** Any MCP toggle that's off — or whose underlying server isn't reachable / isn't built — falls back to mock data. The UI keeps working. You can stage MCPs one at a time without breaking anything.
- **API keys go in `apps/web/.env.local`, not repo root.** The wizard writes there for you. If you edit by hand and put them at the repo root, the Next.js dev server (which runs with `cwd = apps/web`) won't load them.
- **Restart after config edits.** Next.js caches `config.local.yaml` and env vars once at boot. Save in `/setup`, restart, then refresh.
- **Vault writes are atomic** (`writeFileAtomic`). You won't see half-written files. But config and env changes need a restart to take effect.
- **OAuth popups need to be allowed for `localhost:3000`** the first time ContextA8C or Fathom is called. Tokens cache at `~/.mcp-auth` after that.
- **Background scheduler is opt-in.** `/settings` has four scheduler cards: Daily briefing (HH:MM), Ping monitor (every N min), Fathom sync, Hive Mind sync. Each only fires while `pnpm dev` is up; for firing when dev is down, see the matching `scripts/launchd/com.smithers.<job>.plist.example` — copy to `~/Library/LaunchAgents/com.smithers.<job>.plist`, edit the interval to match your settings, then `launchctl load` it. Schedule edits require a dev-server restart to re-register timers.
- **Don't auto-post anywhere.** Every AI affordance produces a draft you review before sending. `Save as draft` writes to your vault (and to Hive Mind for linked partner projects); nothing sends.

---

## Next reads

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces fit (vault, MCP client, agents, UI).
- [`docs/HIVE-MIND.md`](docs/HIVE-MIND.md) — what data Smithers reads vs. writes to your Hive Mind clone.
- [`docs/PROJECT-METADATA.md`](docs/PROJECT-METADATA.md) — frontmatter fields on `Projects/<slug>.md` files.
- [`CLAUDE.md`](CLAUDE.md) — guidance for AI coding agents working in the repo. Useful for humans too if you're planning to contribute slices.
