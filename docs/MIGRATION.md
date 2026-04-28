# Migration — from notes-folder + cron to Smithers

If you're coming from a setup like the one Smithers grew out of (an Obsidian vault under `~/Documents/A8C Claude/` with a `Scripts/` folder of cron + launchd jobs invoking `claude` CLI), this is the path to migrate without breaking anything.

## Principle

> The existing system runs unchanged until cutover.

Smithers reads your vault from day one but does not write to it for `partner`-kind projects until you're ready. Background jobs are added in parallel, not as replacements, so the existing morning briefing keeps working while you evaluate the Smithers one.

## Phases

### 1. Install Smithers in parallel

```bash
git clone https://github.com/unicornfancy/smithers.git ~/smithers
cd ~/smithers
pnpm install
pnpm dev
# → http://localhost:3000/setup
```

Wizard points at your existing vault path. No vault writes happen yet.

### 2. Verify reads

For a few days, use Smithers alongside Obsidian and your existing daily note. Check that:

- Project lists match
- Drafts render correctly
- Follow-ups parse
- ContextA8C live data shows up

### 3. Enable Smithers' background jobs (parallel)

Install Smithers' launchd jobs from `scripts/launchd/` with non-conflicting times. Both systems run; you compare outputs.

### 4. Cutover

When Smithers' briefing/ping monitor/sync are reliably better:

1. Disable old launchd jobs (`launchctl unload ~/Library/LaunchAgents/com.user.<job>.plist`).
2. Optionally archive old `Scripts/` folder; keep `Templates/`, `Style Guide`, `Daily Notes/`, etc.
3. Open the first vault write against a non-partner project to smoke-test.
4. Then proceed with partner-kind writes.

### 5. Hive Mind onboarding (optional, separate path)

1. Clone `Team51-Hive-Mind` to `~/Team51-Hive-Mind/` (sibling to `~/smithers/`).
2. /settings → Paths → Hive Mind path: confirm autodetect.
3. Existing partner projects in your vault stay as `team` or `personal` kind until you choose to migrate them up. Migration is opt-in per project via the **Change project kind** action.

## Things to know

- **Daily Notes/** in your vault keep being written to (as a journaling side-effect of /today). You can keep using Obsidian to read them.
- **Working With You.md** and **`<You>` Style Guide.md** are read on first run and become editable in /style-guide. Edits there write back to those files.
- **Drafts/** is migrated in place; existing drafts get UUIDs added on first read (non-destructive frontmatter merge). `Originals/` and `Archived/` subfolders are preserved.
- **Scripts/** is left alone. Remove it manually when you're ready.

## Rolling back

You can always go back: stop running `pnpm dev`, re-enable old launchd jobs, keep using Obsidian. Smithers writes only to `~/.smithers/` (cache) and to the vault files you explicitly touched in the UI. Diffs are visible in `git` if your vault is versioned.
