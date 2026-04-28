# prompts/

Long-form prompt templates referenced by `packages/agents`. Kept here (rather than inline in TS) so they can be edited without recompiling and so iteration on prompts shows up cleanly in PR diffs.

Naming: `<agent-name>.md` with optional `<agent-name>.system.md` for the system prompt and `<agent-name>.user.md` for the user template. Agents that take additional context fragments may add `<agent-name>.context.<bit>.md`.

To be filled in as agents land. See `packages/agents/src/index.ts` for the agent name list.
