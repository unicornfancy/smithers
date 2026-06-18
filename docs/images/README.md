# Screenshot checklist for ONBOARDING.md

Each image in this folder is referenced from [`ONBOARDING.md`](../../ONBOARDING.md). Take them once and they render inline in the guide. Filenames are stable so swapping in a new version (after a UI update) just overwrites the same path.

**Naming convention:** `NN-section-short-description.png` where `NN` is roughly the ONBOARDING section. PNG preferred (sharper for UI), JPEG fine for photos. Crop tight — no Mac desktop wallpaper, no extra browser chrome where avoidable.

**Mac screenshot tips:**
- `Cmd+Shift+4` → drag a region. Saves to Desktop by default.
- `Cmd+Shift+5` → screenshot toolbar with options (Window, Screen, timed).
- `Cmd+Shift+4` then `Space` → click a window to capture just that window cleanly (no surrounding desktop).

---

## Section 1 — Install the tools Smithers needs

### `01-terminal-versions.png` (recommended)
A clean Terminal window with both `node --version` and `pnpm --version` showing successful output (v20+ and v9+ respectively). Captures the "verify install worked" step.

---

## Section 2 — Download Smithers itself

### `02-pnpm-install-done.png` (recommended)
Terminal showing the tail of a successful `pnpm install` (the `Done in X.Ys` line plus a few lines of context above it). Reassures readers their install worked even when there were deprecation warnings along the way.

---

## Section 4 — Start Smithers for the first time

### `04-pnpm-dev-ready.png` (high priority)
Terminal showing `▲ Next.js 15.x.x`, `Local: http://localhost:3000`, and `Ready in X.Xs`. The visual cue that the server actually started.

### `04-setup-wizard-fresh.png` (high priority)
Browser screenshot of `http://localhost:3000/setup` on a fresh install — yellow "Finish setup to use Smithers" banner at the top, empty Paths card, empty API keys card, MCP servers card with everything off. The orientation page.

---

## Section 5 — Point Smithers at your notes folder

### `05-vault-saved.png` (high priority)
The Paths card with the Vault field filled in and showing the green **Found** badge. The "this is what success looks like" reference.

---

## Section 6 — Add your Anthropic API key

### `06-anthropic-key-set.png` (high priority)
The API keys card showing the green **Set** badge next to Anthropic API key (don't actually capture the key value — just the masked field + green badge).

---

## Section 7 — Connect to the outside world (MCPs)

### `07-mcps-on.png` (recommended)
The MCP servers card with ContextA8C, Hive Mind, and Fathom all toggled ON. Shows what "fully connected" looks like.

### `07-oauth-popup.png` (high priority — people miss these)
The OAuth popup that appears on first ContextA8C / Fathom call. Capture it on the Slack or Linear consent screen, before clicking Allow. Annotates the "allow popups" warning visually.

---

## Section 8 — Restart and check `/today`

### `08-today-fresh.png` (high priority)
The `/today` dashboard right after first load, with at least the header, Top 3 for today card (empty-state text), Pings to action panel, and Recent calls visible. This is the "you made it" payoff screenshot.

### `08-projects-onboard.png` (recommended)
The `/projects/onboard` page showing the join table of Linear projects + Hive Mind partners + scratchpads. Most readers haven't seen it yet — visual orientation.

---

## Section 9 — Google Drive activity tracking

These are the ones that bite people without screenshots — Google Cloud Console's UI changes frequently.

### `09-gcp-create-project.png` (high priority)
The Google Cloud Console "New Project" page from <https://console.cloud.google.com/projectcreate>. Project name field, organization picker, Create button. Helps readers know they're on the right page.

### `09-gcp-enable-drive-api.png` (high priority — this is the step that got skipped in testing)
The Drive API library page at <https://console.cloud.google.com/apis/library/drive.googleapis.com> with the project selector visible at the top and the big blue **Enable** button. The step that broke things silently when missed.

### `09-gcp-oauth-consent.png` (recommended)
The OAuth consent screen at <https://console.cloud.google.com/apis/credentials/consent> with User type picker (Internal vs External), app name field, support email.

### `09-gcp-create-client-id.png` (recommended)
The "Create OAuth client ID" form: Application type set to **Desktop app**, name set to "Smithers local".

### `09-gcp-download-json.png` (high priority)
Either the popup with the Download JSON button, OR the Credentials list page showing the download icon (⬇) at the end of the "Smithers local" row. Whichever you used.

### `09-auth-flow-terminal.png` (high priority)
Terminal showing the successful auth flow output: the deprecation warnings, `Launching auth flow…`, then `Credentials saved. You can now run the server.` All in one frame.

### `09-drive-activity-in-feed.png` (high priority)
Live Activity feed on a project workbench showing at least one row labeled "GDrive" with a file name and modified-by actor. The payoff for the Drive section.

---

## How to embed a screenshot in the docs

The references are already in `ONBOARDING.md`. If you add a new one:

```markdown
![What the screenshot shows for screen readers](docs/images/NN-section-name.png)
```

Keep alt text descriptive (it's read by screen readers AND it shows when the image is missing). Captions, when needed, go directly below as italicized text:

```markdown
![Setup wizard on first load](docs/images/04-setup-wizard-fresh.png)

*The yellow banner lists what's still missing. Each section becomes green as you fill it in.*
```
