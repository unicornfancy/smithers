# Onboarding — first-time setup for Smithers

This guide walks you through setting up Smithers from scratch on a Mac. It assumes nothing — every step has a "what this does" explanation, a "what you should see" success check, and a "what if it didn't work" note.

If you're already comfortable with the terminal and just want the short version, the [README](README.md) has it. Come back here when something doesn't behave.

> **The single most important thing to remember:** Smithers reads its configuration once when it starts. **After you change any setting through the wizard, you have to stop and restart `pnpm dev`** — otherwise your change won't take effect. We'll remind you whenever it matters.

Estimated time: **20–40 minutes** depending on how much you're connecting (Hive Mind, Linear, Google Drive, etc.). The Anthropic API key + vault path are the only hard requirements; everything else is optional.

---

## Table of contents

- [0. Before you start — what you'll need](#0-before-you-start--what-youll-need)
- [1. Install the tools Smithers needs](#1-install-the-tools-smithers-needs)
- [2. Download Smithers itself](#2-download-smithers-itself)
- [3. (Recommended) Set up Hive Mind](#3-recommended-set-up-hive-mind)
- [4. Start Smithers for the first time](#4-start-smithers-for-the-first-time)
- [5. Point Smithers at your notes folder (the "vault")](#5-point-smithers-at-your-notes-folder-the-vault)
- [6. Add your Anthropic API key](#6-add-your-anthropic-api-key)
- [7. Connect to the outside world (MCPs)](#7-connect-to-the-outside-world-mcps)
- [8. Restart and check `/today`](#8-restart-and-check-today)
- [9. (Optional) Set up Google Drive activity tracking](#9-optional-set-up-google-drive-activity-tracking)
- [Troubleshooting](#troubleshooting)
- [Where things live on disk](#where-things-live-on-disk)
- [Day-to-day gotchas worth knowing](#day-to-day-gotchas-worth-knowing)

---

## 0. Before you start — what you'll need

Gather these before you begin so you're not stopping mid-setup to chase things down:

- **A Mac** (Smithers also runs on Linux; Windows isn't supported yet).
- **An Anthropic Claude Enterprise API key.** Follow the [Field Guide](https://fieldguide.automattic.com/claude-enterprise/#enterprise-uses-sso-not-api-keys) to request one. Keep it somewhere safe — you'll paste it into the Smithers setup wizard.
- **(Recommended) Access to [Team51-Hive-Mind](https://github.com/a8cteam51/Team51-Hive-Mind).** Smithers reads partner project data from a local copy. Without it, partner workbenches show placeholder data.
- **(Optional) A Linear personal API key.** Get one from [Linear → Settings → API](https://linear.app/settings/api). Without it, Linear data still loads via the ContextA8C MCP, just read-only and slower.
- **(Optional) A Google Cloud account.** Needed for Google Drive activity tracking. Setup is involved; cover it in [Section 9](#9-optional-set-up-google-drive-activity-tracking) once everything else is working.

---

## 1. Install the tools Smithers needs

Smithers needs three command-line tools: **Homebrew** (a Mac package manager), **Node.js** (the runtime), and **pnpm** (a package manager). If you already have all three, skip ahead to step 2.

### Open Terminal

`Cmd+Space` to open Spotlight → type `terminal` → press `Enter`. You'll see a window with a prompt that looks something like:

```
yourname@yourmac ~ %
```

This is where you'll be typing commands for the next few minutes. **Tip:** you can copy/paste commands directly from this guide into Terminal.

### Install Homebrew (if you don't have it)

Type this command and press `Enter`:

```bash
which brew
```

- If it prints a path like `/opt/homebrew/bin/brew`, you already have Homebrew → skip to "Install Node and pnpm".
- If it prints nothing (or "brew not found"), install it by pasting this in:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Homebrew will ask for your Mac password (you won't see characters as you type — that's normal). It takes a few minutes.

**You should see:** an `==> Installation successful!` line near the end, followed by "Next steps" with a couple of commands to add Homebrew to your shell. **Run those exact commands** — they're customized for your username.

### Install Node and pnpm

Paste this and press `Enter`:

```bash
brew install node pnpm
```

This takes a minute or two. When it finishes, verify both installed:

```bash
node --version    # should print v20.x.x or higher
pnpm --version    # should print 9.x.x or higher
```

**You should see** version numbers. If you get "command not found", close Terminal and reopen it — the install needs a fresh shell to pick up the new tools.

### Install Git (if you don't have it)

Almost every Mac comes with Git pre-installed, but let's check:

```bash
git --version
```

If macOS asks to install Xcode Command Line Tools, click **Install** and wait a few minutes. If it prints a version like `git version 2.x.x`, you're set.

---

## 2. Download Smithers itself

In Terminal:

```bash
git clone https://github.com/unicornfancy/smithers.git ~/smithers
cd ~/smithers
```

The `git clone` line downloads Smithers into a folder called `smithers` in your home directory (the `~/` shortcut). The `cd` line moves into that folder.

**You should see** ~20–30 lines of output as files download, ending with the new Terminal prompt now showing `smithers` in the path:

```
yourname@yourmac smithers %
```

Now install Smithers' own dependencies (the code libraries it uses):

```bash
pnpm install
```

This takes 1–3 minutes the first time and downloads several hundred MB. **You should see** a lot of progress output, finishing with a `Done` line.

**If something goes wrong:**
- "command not found: pnpm" → restart Terminal (the install in step 1 needs a fresh shell).
- Errors mentioning a Node version → check `node --version` is 20 or higher; if not, run `brew upgrade node`.

---

## 3. (Recommended) Set up Hive Mind

Skip this step if you don't have access to Team51-Hive-Mind yet — Smithers will show placeholder partner data until you come back to this.

Hive Mind is where Team51 stores partner project knowledge. Smithers reads from a local copy of it on your laptop.

```bash
git clone https://github.com/a8cteam51/Team51-Hive-Mind.git ~/Team51-Hive-Mind
cd ~/Team51-Hive-Mind/mcp/server
npm install
npm run build
```

The first two commands clone the repo. The last two build the small server that Smithers uses to talk to Hive Mind data.

**You should see** a `dist/` folder appear inside `mcp/server/` after the build finishes. That's the file Smithers will look for.

Now move back to the Smithers folder for the next steps:

```bash
cd ~/smithers
```

**If something goes wrong:**
- "Repository not found" or "Permission denied" → you don't have access yet. Ask your team lead for an invite to the `a8cteam51` org, then re-try.
- The `npm run build` step fails → ask in `#team-51` channel; it's an issue on the Hive Mind side, not yours.

---

## 4. Start Smithers for the first time

You're still in `~/smithers`. Start the dev server:

```bash
pnpm dev
```

**You should see** something like:

```
   ▲ Next.js 15.x.x
   - Local:        http://localhost:3000
   - Ready in 2.1s
```

Leave this Terminal window running — closing it stops Smithers. (We'll need to come back and restart it later.)

Open a web browser and visit: **http://localhost:3000/setup**

You'll see a wizard page with a yellow banner that says something like "Finish setup to use Smithers" — that's correct. Right now Smithers doesn't know where your notes are or what your API key is. The wizard walks you through filling those in.

**If something goes wrong:**
- The page won't load → check the Terminal window for an error message. Most likely `pnpm dev` didn't actually start (look for `Ready in X.Xs`).
- Port 3000 already in use → another app is using that port. Quit it (often another `pnpm dev`) and re-run.

---

## 5. Point Smithers at your notes folder (the "vault")

In Smithers-speak, the **vault** is the folder of markdown files that holds your notes, projects, drafts, weekly updates, etc. It's just a regular folder of `.md` files — Obsidian-compatible but not Obsidian-required.

### If you already use Obsidian

In the **Paths** card on `/setup`, type the path to your Obsidian vault. Something like:

```
~/Documents/A8C Claude
```

Click **Save**.

### If you don't have a vault yet

That's fine — Smithers will create whatever it needs. Pick a folder name and make it:

In Terminal (open a new window so you don't disturb the running `pnpm dev`):

```bash
mkdir -p ~/Smithers-Vault
```

Then in the wizard, set **Vault** to `~/Smithers-Vault` and click **Save**.

**You should see** the green **Found** badge next to the Vault path.

**If you see "Path not found":** the folder you typed doesn't actually exist on disk. Check the resolved path shown beneath the input — if it shows `/Users/yourname/Smithers-Vault` and that folder doesn't exist, create it (see "If you don't have a vault yet" above).

### Set the Hive Mind path (if you did step 3)

In the same Paths card, set **Hive Mind** to `~/Team51-Hive-Mind` and click **Save**. The green badge should appear.

If you skipped step 3, leave Hive Mind blank for now — partner workbenches will show placeholder data, and you can come back to this anytime.

### My Voice (optional, can skip for now)

Leave blank. The "my voice" skill files customize the writing style of AI-drafted messages. Most TAMs leave this blank and let Smithers use sensible defaults.

---

## 6. Add your Anthropic API key

Without this, the AI-assisted drafting features won't work. Everything else still does.

In the **API keys** card, paste your `sk-ant-…` key into the **Anthropic API key** field and click **Save**.

**You should see** the green **Set** badge next to "Anthropic API key".

**Important:** the wizard writes the key to `apps/web/.env.local` (an ignored file that doesn't get committed to Git). You don't need to do anything else with it.

If you have a **Linear API key**, paste it into the Linear field too. Without it, Linear data still loads via ContextA8C (read-only), so this is genuinely optional.

---

## 7. Connect to the outside world (MCPs)

"MCP" stands for **Model Context Protocol** — it's how Smithers talks to outside services. Three MCPs are pre-wired:

| MCP | What it gives you |
|---|---|
| **ContextA8C** | Slack messages, GitHub activity, Linear issues, Zendesk tickets, P2 threads |
| **Hive Mind** | Partner project data — briefs, contacts, decisions, follow-ups |
| **Fathom** | Your meeting recordings + transcripts |

In the **MCP servers** card, toggle ON the ones you want using real data. Each toggle off means Smithers shows placeholder data for that source — useful while you're still setting things up.

### ContextA8C

Turn this ON. The first time Smithers makes a call (after restart), a browser tab pops to authorize OAuth. **Allow the popup**, sign in with your Automattic account, and the tab closes automatically. The token caches at `~/.mcp-auth` — you won't be asked again unless it expires.

### Hive Mind

Turn this ON only if you did step 3 (cloned + built Hive Mind). If you see a green "Server built and ready" badge, you're good. If you see an amber warning with a `cd ~/Team51-Hive-Mind/mcp/server && npm install && npm run build` command, run those — the build didn't complete in step 3.

### Fathom

Turn ON if you use Fathom for meeting recording. Same OAuth-on-first-call pattern as ContextA8C.

---

## 8. Restart and check `/today`

Now the big moment. Switch back to the Terminal window running `pnpm dev`:

1. Press `Ctrl+C` to stop it (you'll see the prompt come back).
2. Run `pnpm dev` again.
3. Wait for the `Ready in X.Xs` line.

Open `http://localhost:3000/today` in your browser.

**You should see** a dashboard with these cards (most are empty on a fresh vault — that's correct):

- **Header** says today's date.
- **Top 3 for today** — empty until you have projects + pings; placeholder text explains.
- **Pings to action** — populated from ContextA8C if you enabled it. First load may show a Slack/Linear OAuth popup; allow it.
- **Recent calls** — populated from Fathom if enabled.
- **Stalls** / **Follow-ups waiting** — empty until you have follow-ups.

**If you see** "Vault not found", you saved the vault path but didn't restart `pnpm dev`. Go back to step 8.1.

### Add your first project

From the sidebar:
- **Projects → onboard** — joins your Linear projects, Hive Mind partners, and any existing vault scratchpads into one list. The right entry point if you already have partners in Hive Mind. Each row has Import / Connect / Set up buttons.
- **Projects → New** — minimal form to create a brand-new vault-only project (team or personal). Use this for internal initiatives that don't live in Hive Mind.

After adding a project, click its row from `/projects` to open its workbench page. That's where Smithers really starts to feel useful.

---

## 9. (Optional) Set up Google Drive activity tracking

If you store partner files in Google Drive folders, Smithers can surface recent file activity in the per-project Live Activity feed. **This is a 15-minute one-time setup** with a non-trivial Google Cloud dance — leave it for later if you want to start using Smithers first.

### Step 1: Create a Google Cloud project

1. Go to https://console.cloud.google.com/projectcreate.
2. Name it something like "Smithers Drive". Organization: whatever's available for your Automattic account, or "No organization" for a personal project.
3. Click **Create** and wait for it to spin up (~10 seconds). Note the **Project ID** (you'll see it in the project selector top-left).

### Step 2: Enable the Drive API on that project

> **This is the step that got skipped in beta-testing and broke things silently.** Don't skip it.

1. Go to https://console.cloud.google.com/apis/library/drive.googleapis.com.
2. Make sure the project selector at the top shows the project you just created.
3. Click **Enable**. Wait ~30 seconds.

### Step 3: Configure the OAuth consent screen

1. Go to https://console.cloud.google.com/apis/credentials/consent.
2. User type:
   - **Internal** if Automattic shows up as an option — easiest path.
   - **External** otherwise — fine, just stays in "Testing" mode and you'll need to add yourself as a test user later in this same screen.
3. App name: "Smithers Drive". Support email + developer contact: your email. Click **Save**.
4. On the **Scopes** page, click **Add or remove scopes**, search for `https://www.googleapis.com/auth/drive.readonly`, check the box, click **Update**, then **Save**.
5. (External user-type only) On the **Test users** page, click **Add users**, add your own Google account, click **Save**.

### Step 4: Create an OAuth Client ID

1. Go to https://console.cloud.google.com/apis/credentials.
2. Click **+ Create credentials** → **OAuth client ID**.
3. Application type: **Desktop app**.
4. Name: "Smithers local".
5. Click **Create**.

A popup appears with **Download JSON**. Click it.

**If the Download JSON button doesn't work** (common in Brave / Safari): close the popup, then on the Credentials list page click the **download icon (⬇)** at the end of the "Smithers local" row.

### Step 5: Move the downloaded file into place

In Terminal:

```bash
mkdir -p ~/.smithers
mv ~/Downloads/client_secret_*.apps.googleusercontent.com.json ~/.smithers/gcp-oauth.keys.json
```

**Important:** `~/.smithers/` (with the leading dot) is your data directory in your home folder. **Not** the Smithers code repo at `~/smithers/` (no dot). Two different folders.

### Step 6: Run the OAuth flow

This is where you grant Smithers permission to read your Drive files. Run:

```bash
GDRIVE_OAUTH_PATH=~/.smithers/gcp-oauth.keys.json \
GDRIVE_CREDENTIALS_PATH=~/.smithers/gdrive-server-credentials.json \
npx -y @modelcontextprotocol/server-gdrive auth
```

> **Important:** the env var name is `GDRIVE_CREDENTIALS_PATH` (full word), not `GDRIVE_CREDS_PATH` (shortened). The MCP server only reads the long name; if you abbreviate, the auth flow completes but the credentials file goes to the wrong place.

What you'll see, in order:

1. Some npm warnings about deprecated packages — ignore them.
2. A line that says `Launching auth flow…`.
3. A browser tab opens with a Google sign-in page.
4. Sign in with your Automattic Google account.
5. (If External user-type) you may see a "This app is not verified" warning. Click **Advanced** → **Continue to Smithers Drive (unsafe)**. It's fine — you trust yourself.
6. A consent screen asking to view your Drive files (read-only). Click **Allow**.
7. The browser tab closes / says "Authentication successful."
8. The Terminal prints `Credentials saved. You can now run the server.` and exits.

### Step 7: Verify the credentials file landed where Smithers expects

```bash
ls ~/.smithers/gdrive-server-credentials.json
```

**You should see** the file listed with its size in bytes. If the command says "No such file or directory," the credentials saved to the wrong place. Check:

```bash
find ~/.npm/_npx -name ".gdrive-server-credentials.json" 2>/dev/null
```

If it finds a file there, move it:

```bash
cp ~/.npm/_npx/*/node_modules/.gdrive-server-credentials.json ~/.smithers/gdrive-server-credentials.json
```

### Step 8: Restart `pnpm dev`

Same restart pattern as before — `Ctrl+C`, then `pnpm dev` again. Now the Drive MCP is on.

### Step 9: Set a Drive folder URL on a project

1. Open any project's workbench page.
2. Click the **pencil icon** next to the project name (top header).
3. Paste a Google Drive folder URL into the **Google Drive folder URL** field. Example: `https://drive.google.com/drive/folders/1AbCdEfGhIjK...`
4. Click **Save**.

Refresh the workbench. The Live Activity feed should now include rows from that Drive folder (and any subfolders, up to 4 levels deep). Click the **GDrive** chip in the filter row to show only Drive events.

**If Drive rows don't appear** even after restarting and saving:
- Check the Terminal where `pnpm dev` is running for any "Google Drive API has not been used in project … or it is disabled" errors. That means step 2 (Enable the API) didn't take — go back and do it.
- For Shared Drive folders, the activity may take 5 minutes to appear due to caching. If still nothing after 5 minutes, share the folder URL with the team and we'll diagnose.

---

## Troubleshooting

The most common first-run errors and how to fix them.

| What you're seeing | Likely cause | Fix |
|---|---|---|
| Wizard shows path as **Found** but `/today` says "Vault not found" | You saved the path but didn't restart `pnpm dev`. | Restart the server (`Ctrl+C`, then `pnpm dev`). |
| "Not configured" on Pings to action after enabling ContextA8C | OAuth popup was blocked, or you closed it before signing in. | Reload `/today` to retrigger; allow popups for `localhost:3000`. |
| Hive Mind panel shows placeholder data even after enabling it | The Hive Mind MCP server wasn't built. | `cd ~/Team51-Hive-Mind/mcp/server && npm install && npm run build`, then restart `pnpm dev`. |
| "Claude not configured" on the Top 3 card | The Anthropic API key isn't being read. | In `/setup`, verify the Anthropic row shows the green **Set** badge. If yes, restart `pnpm dev`. If no, paste the key again and re-save. |
| Linear inbox panel says "degraded" with stale cache | ContextA8C session expired. | Reload the page. If it persists, restart `pnpm dev` to re-OAuth on the next call. |
| `Cannot find module '@modelcontextprotocol/sdk'` in browser console | Build cache out of sync. | `rm -rf apps/web/.next` then restart `pnpm dev`. |
| `pnpm dev` fails to start with a port error | Another app (often a previous `pnpm dev`) is using port 3000. | Find it: `lsof -i :3000`. Quit that process, then restart. |
| The Terminal closes unexpectedly while Smithers is running | This stops Smithers. | Reopen Terminal, `cd ~/smithers`, run `pnpm dev` again. |
| You're stuck on a specific error not listed here | — | Open [TROUBLESHOOTING.md](TROUBLESHOOTING.md) or ask in `#team-51`. |

---

## Where things live on disk

Helpful when something seems "stuck" and you want to inspect or reset it.

| What | Where |
|---|---|
| The Smithers code itself | `~/smithers/` (no dot) |
| Your local config (gitignored) | `~/smithers/config.local.yaml` |
| API keys (gitignored) | `~/smithers/apps/web/.env.local` |
| SQLite cache, logs, Drive credentials | `~/.smithers/` (with dot) |
| OAuth tokens for ContextA8C / Fathom | `~/.mcp-auth/` |
| Your vault | wherever you set it in `/setup` |
| Hive Mind clone | wherever you set it in `/setup` (typically `~/Team51-Hive-Mind`) |

---

## Day-to-day gotchas worth knowing

These will save you frustration once you're using Smithers regularly.

- **Mock mode is the safety net.** Any MCP that's off — or whose server isn't reachable — falls back to placeholder data. The UI keeps working so you can keep exploring while you sort the integration out.
- **Restart after config edits.** Smithers reads `config.local.yaml` and `.env.local` once at boot. Save, restart, refresh.
- **Vault writes are atomic.** You'll never see a half-written file. But config changes need a restart.
- **OAuth popups need to be allowed for `localhost:3000`** the first time ContextA8C / Fathom is called. Tokens cache at `~/.mcp-auth` after that.
- **The background scheduler is opt-in.** `/settings` has cards for Daily briefing, Ping monitor, Transcription sync, Hive Mind sync, Team roster sync. Each only fires while `pnpm dev` is up; for firing when dev is down, see `scripts/launchd/com.smithers.<job>.plist.example`.
- **Nothing posts automatically.** Every AI draft is yours to review before sending. "Save as draft" writes to your vault; nothing leaves your machine without an explicit Send / Post.
- **Markdown is the source of truth.** Anything Smithers shows you came from a file you can open and edit yourself. The SQLite cache at `~/.smithers/state.db` is purely for performance; deleting it just makes the next request slower.

---

## What to read next

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit together.
- [docs/HIVE-MIND.md](docs/HIVE-MIND.md) — what Smithers reads vs. writes to your Hive Mind clone.
- [docs/PROJECT-METADATA.md](docs/PROJECT-METADATA.md) — the frontmatter fields each project file supports.
- [CLAUDE.md](CLAUDE.md) — guidance for AI coding agents working in this repo. Useful for humans too if you're planning to contribute.

Welcome to Smithers. 🎩
