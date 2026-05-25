# TROUBLESHOOTING.md — Smithers

Quick-reference for "Smithers is acting weird, what do I run?"

---

## Dev server (LaunchAgent)

Smithers runs as a launchd agent on login — `~/Library/LaunchAgents/com.smithers.dev.plist` calls `bin/smithers-server.sh`, which sources nvm and execs `pnpm dev`. Logs land at `~/.smithers/dev-server.log`.

```bash
tail -f ~/.smithers/dev-server.log                                # watch server output
launchctl list | grep smithers                                    # is it running? (PID column = yes; "-" = not)
launchctl unload ~/Library/LaunchAgents/com.smithers.dev.plist    # stop
launchctl load   ~/Library/LaunchAgents/com.smithers.dev.plist    # start
```

To make a clean restart after a config or .env change: unload, then load.

If you'd rather run it manually in a terminal (e.g. for one-off debugging):

```bash
launchctl unload ~/Library/LaunchAgents/com.smithers.dev.plist    # stop the auto-managed one first
cd ~/smithers && pnpm dev
```

---

## When the server won't start

```bash
lsof -i :3000                # something else using port 3000?
tail -50 ~/.smithers/dev-server.log   # what's the last error?
```

If port 3000 is in use:

```bash
kill $(lsof -ti :3000)       # kill whatever is squatting on it
launchctl load ~/Library/LaunchAgents/com.smithers.dev.plist
```

If the agent keeps restarting itself in a loop, `launchctl list | grep smithers` will show a non-zero exit code in the middle column. The ThrottleInterval=30s in the plist means it won't loop faster than every 30 seconds; check the log to see why it's exiting.

---

## When a page crashes in the browser

| Symptom | Likely cause | Fix |
|---|---|---|
| `Cannot read properties of undefined (reading 'call')` | Stale webpack chunks after many hot reloads | Hard refresh (Cmd+Shift+R). If still broken: `rm -rf apps/web/.next` + restart server. |
| `Hydration failed because the server rendered text didn't match the client` on a relative timestamp | New `formatRelative(...)` span without `suppressHydrationWarning` | Add the prop to the `<span>` |
| `no such table: <name>` | New SQLite migration didn't run on the cached connection | Should self-heal next request (db.ts re-runs idempotent migrations on every `getDb()`); if not, restart server |
| `Cannot find module '@modelcontextprotocol/sdk'` in a client component | Server-only import dragged into client bundle | Check imports — `serverExternalPackages` in next.config.ts may need updating |
| Linear inbox / Slack / Zendesk panel says "degraded" | ContextA8C session expired | Reload page; if persistent, restart server to re-OAuth |

---

## Database + SQLite state

Smithers' SQLite cache lives at `~/.smithers/state.db`. Vault markdown is the source of truth — everything in SQLite is reproducible.

```bash
sqlite3 ~/.smithers/state.db ".tables"              # what's in there?
sqlite3 ~/.smithers/state.db "SELECT value FROM meta WHERE key='schema_version'"
sqlite3 ~/.smithers/state.db "SELECT * FROM user_actions ORDER BY created_at DESC LIMIT 20"
sqlite3 ~/.smithers/state.db "SELECT * FROM ping_actioned ORDER BY checked_at DESC LIMIT 20"
```

Nuclear reset (loses dismiss/pin/actioned history; UI prefs in localStorage survive):

```bash
launchctl unload ~/Library/LaunchAgents/com.smithers.dev.plist
rm ~/.smithers/state.db ~/.smithers/state.db-wal ~/.smithers/state.db-shm
launchctl load ~/Library/LaunchAgents/com.smithers.dev.plist
```

---

## Config + secrets

```bash
# Effective config (merges defaults + config.local.yaml)
cat ~/smithers/config.local.yaml

# API keys live here, not in config — and not in git
cat ~/smithers/apps/web/.env.local

# Hive-Mind MCP server build status (must exist for HM features to work)
ls ~/Team51-Hive-Mind/mcp/server/dist/index.js && echo "built" || echo "needs build — run 'pnpm build' in ~/Team51-Hive-Mind/mcp/server/"
```

`/setup` in the browser is the GUI for editing most of these. After editing config or env, restart the server (`launchctl unload && load`).

---

## Vault sanity

```bash
# Confirm vault path resolves to what you expect
grep "vault:" ~/smithers/config.local.yaml

# Spot-check a project file
ls "$(grep 'vault:' ~/smithers/config.local.yaml | awk -F'"' '{print $2}' | sed "s|~|$HOME|")/Projects/" | head
```

Smoke test the vault write helpers (touches a temp project, exercises every write path):

```bash
cd ~/smithers && npx tsx packages/vault/scripts/smoke-toggle.mjs
```

---

## Typecheck + build

```bash
cd ~/smithers
pnpm -r typecheck                    # all packages
pnpm --filter @smithers/web typecheck
pnpm --filter @smithers/vault typecheck
```

Clear Next's build cache (fixes a class of weird module-resolution errors):

```bash
rm -rf apps/web/.next
launchctl unload ~/Library/LaunchAgents/com.smithers.dev.plist
launchctl load   ~/Library/LaunchAgents/com.smithers.dev.plist
```

---

## Git state

```bash
cd ~/smithers
git status
git log --oneline -20                # recent work
git diff --stat                       # what's pending
```

---

## Where things live

| Thing | Path |
|---|---|
| App source | `~/smithers/apps/web/` |
| Packages | `~/smithers/packages/{vault,mcp-client,agents,...}/` |
| Local config (gitignored) | `~/smithers/config.local.yaml` |
| API keys (gitignored) | `~/smithers/apps/web/.env.local` |
| SQLite state | `~/.smithers/state.db` |
| Dev server log | `~/.smithers/dev-server.log` |
| LaunchAgent | `~/Library/LaunchAgents/com.smithers.dev.plist` |
| Wrapper script | `~/smithers/bin/smithers-server.sh` |
| Vault | per `config.local.yaml` `paths.vault` (default `~/Documents/A8C Claude`) |
| Hive-Mind clone | per `config.local.yaml` `paths.hive_mind` (default `~/Team51-Hive-Mind`) |
| my-voice files | per `config.local.yaml` `paths.my_voice` |
