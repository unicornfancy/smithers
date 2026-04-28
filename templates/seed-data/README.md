# templates/seed-data/

NDA-safe demo content for screenshots, demos, and the eventual `pnpm seed` mock-mode. Point Smithers at `templates/seed-data/vault/` to see a fully-populated UI without needing access to a real vault.

## Layout

```
templates/seed-data/
└── vault/                  ← point config.yaml `paths.vault` here for a demo
    ├── Daily Notes/
    ├── Drafts/
    │   ├── Originals/
    │   └── Archived Drafts/
    ├── Call Notes/
    ├── Agendas/
    ├── Projects/
    │   ├── ClimateFirst Foundation Phase 2/   (folder layout, partner kind)
    │   ├── OpenSource Initiative Q4.md         (flat, team kind, hot)
    │   ├── Documentation Sprint.md             (flat, personal kind)
    │   └── Annual Newsletter.md                (flat, partner kind, cold + next_nudge)
    ├── Weekly Updates/
    ├── Templates/
    ├── Working With You.md
    ├── You Style Guide.md
    └── Follow-ups.md
```

## Try it

In `config.yaml`, set:

```yaml
paths:
  vault: "./templates/seed-data/vault"
```

Then `pnpm dev` and `/today` shows the demo content.
