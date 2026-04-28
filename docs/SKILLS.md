# Skills

Smithers uses the Team51 Hive Mind skills convention: each skill lives in a folder with a `SKILL.md` describing what it does and how to invoke it.

## Layout

```
~/Team51-Hive-Mind/.claude/skills/<skill-name>/SKILL.md   ← shared skills
~/smithers/.claude/skills/<skill-name>/SKILL.md           ← personal/local
```

Smithers' `packages/agents` looks in both. Personal skills with the same name override Hive Mind skills (allows you to test changes locally before contributing back).

## Using a skill

In `packages/agents`, an agent declares which skills it can use. The runner loads matching `SKILL.md` files into the prompt context. Skills are essentially named, reusable prompt fragments + tool allowlists.

## Contributing a skill back

1. Build and iterate locally in `~/smithers/.claude/skills/<your-skill>/`.
2. When stable, run **Promote to Hive Mind** (UI action or `pnpm skills:promote <name>`).
3. Promotion creates a branch in `~/Team51-Hive-Mind/`, copies the skill folder, runs the Hive Mind validation hook, and opens a PR.
4. Until merged, the skill stays available locally.

See [`HIVE-MIND.md`](HIVE-MIND.md) for the full integration model.
