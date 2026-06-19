import type { JobContextRefs } from "./types";

/**
 * Shared helper for agents that opt into the job-context channel.
 * Renders the requested refs as markdown sections ready to append
 * to a system prompt. Returns "" when no refs were loaded so the
 * caller can short-circuit without an empty trailing section.
 *
 * Sections are ordered to bias the agent's attention:
 *   1. Role lens (a one-line "you are assisting a <role>" prelude)
 *   2. Team charter (the rubric — most load-bearing)
 *   3. Strategic priorities (this quarter's emphasis)
 *   4. Operating rhythm (cadence + format)
 *   5. Job context (role definition)
 */
export function renderJobContextForPrompt(refs: JobContextRefs): string {
  const sections: string[] = [];
  const role = pickRole(refs);
  if (role) {
    sections.push(
      `# Role context\n\nYou are assisting a ${role}. When interpreting the data below, apply that lens — focus on what the role is actually responsible for / scored on, and de-prioritize what doesn't apply.`,
    );
  }
  if (refs.team_charter) {
    sections.push(`# ${refs.team_charter.label}\n\n${refs.team_charter.body}`);
  }
  if (refs.strategic_priorities) {
    sections.push(
      `# ${refs.strategic_priorities.label}\n\n${refs.strategic_priorities.body}`,
    );
  }
  if (refs.operating_rhythm) {
    sections.push(
      `# ${refs.operating_rhythm.label}\n\n${refs.operating_rhythm.body}`,
    );
  }
  if (refs.job_context) {
    sections.push(`# ${refs.job_context.label}\n\n${refs.job_context.body}`);
  }
  return sections.join("\n\n");
}

function pickRole(refs: JobContextRefs): string | null {
  return (
    refs.job_context?.role ??
    refs.team_charter?.role ??
    refs.strategic_priorities?.role ??
    refs.operating_rhythm?.role ??
    null
  );
}

/**
 * Convenience: append the rendered context to an existing system prompt,
 * returning the prompt unchanged when no refs were provided. Most agents
 * use this directly: `buildSystemPrompt(BASE_PROMPT, input.context)`.
 */
export function attachJobContext(
  basePrompt: string,
  refs: JobContextRefs | undefined,
): string {
  if (!refs) return basePrompt;
  const block = renderJobContextForPrompt(refs);
  return block ? `${basePrompt}\n\n${block}` : basePrompt;
}
