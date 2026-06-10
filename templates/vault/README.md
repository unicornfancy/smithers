# templates/vault/

Starter vault used by users who don't already have a markdown notes folder. Copy any or all of this into the directory you configured as `paths.vault` in `/setup`. None of it is *required* — Smithers creates the subfolders + files it needs on first write — but starting from these gives you a recognizable shape on day one.

## Layout

```
templates/vault/
├── Follow-ups.md                   # Tracker the workbench reads + writes to
├── Style Guide.md                  # Fallback voice doc when no my-voice/ is set
├── Working With You.md             # Personal handoff doc
├── Daily Notes/
│   └── _template.md                # Shape the briefing job writes daily notes in
├── Weekly Updates/
│   └── _template.md                # Shape of YYYY-WNN.md weekly update files
├── Call Notes/
│   └── _template.md                # Shape Process Call writes into Call Notes/
├── Drafts/
│   ├── Originals/                  # Pristine first-pass draft snapshots
│   └── Archived/                   # Sent / no-longer-active drafts
├── Agendas/                        # Per-partner agendas (one file per partner)
└── Projects/
    └── _template/                  # One folder per project; rename + edit
        ├── info.md                 # Frontmatter + Overview + Open Items
        ├── notes.md                # Chronological project log
        └── agenda.md               # Next-meeting agenda + archived past meetings
```

## How to use it

### Copy the whole thing

```bash
mkdir -p ~/Smithers-Vault
cp -R templates/vault/. ~/Smithers-Vault/
```

Then point `/setup → Paths → Vault` at `~/Smithers-Vault`.

### Copy just what you need

Each file / folder is independent:

- `Follow-ups.md` — copy this if you want the table to exist on day one. The vault helper creates it lazily otherwise.
- `Projects/_template/` — copy + rename for each new project (e.g. `Projects/the-pocket-nyc/`). Edit `info.md`'s frontmatter; the rest is yours.
- `Daily Notes/_template.md`, `Weekly Updates/_template.md`, `Call Notes/_template.md` — reference shapes only. Smithers writes new daily notes / weekly updates / call notes itself; the templates show you what to expect.

### Skip the scaffold entirely

Just `mkdir ~/Smithers-Vault`, point the wizard at it, and start using Smithers — the vault helpers create files + directories on first write. The templates here are convenience, not contract.

## Notes

- **Frontmatter is the contract.** When you copy `Projects/_template/info.md`, the YAML at the top is what Smithers reads. Comments mark which fields are optional. Other H2 sections in the body (`## Overview`, `## Open Items`, `## Decisions`) are parsed where relevant — `## Open Items` checkboxes feed the workbench's Open Items panel.
- **Templates aren't auto-imported.** Copying `Projects/_template/` into your vault doesn't make Smithers think it's a real project — rename the folder (and update `slug:` + `name:`) for that.
- **Style Guide.md is the *fallback*.** If you configure `paths.my_voice`, the files there take precedence. The starter Style Guide.md is what agents see when nothing else is configured.
