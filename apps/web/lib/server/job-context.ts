import "server-only";

import type { JobContextDoc, JobContextRefs } from "@smithers/agents";

import { loadConfig } from "./config";
import { readMyVoiceFile } from "./my-voice";

/**
 * Per-doc loaders for the context channel. Each agent declares which
 * slices it needs by calling `loadJobContext({...})` with the relevant
 * flags; only requested files are read off disk. Missing files fall
 * through as undefined — the agent can decide whether to render a
 * fallback prompt section or just skip.
 *
 * The user's role from config is attached to every requested doc so
 * the agent can reason about "what applies to me" without having to
 * thread role through every callsite.
 */
export interface JobContextRequest {
  job_context?: boolean;
  team_charter?: boolean;
  strategic_priorities?: boolean;
  operating_rhythm?: boolean;
}

export async function loadJobContext(
  request: JobContextRequest,
): Promise<JobContextRefs> {
  const cfg = await loadConfig();
  const role = cfg.identity.role?.trim() || "Launch TAM";

  // Run all requested reads in parallel. tryLoad returns undefined when
  // the file is missing — we don't want a missing OPERATING_RHYTHM.md
  // to short-circuit the whole context fetch.
  const [job, charter, priorities, rhythm] = await Promise.all([
    request.job_context ? tryLoad("JOB_CONTEXT.md", "Job context", role) : Promise.resolve(undefined),
    request.team_charter ? tryLoad("TEAM_CHARTER.md", "Team charter", role) : Promise.resolve(undefined),
    request.strategic_priorities
      ? tryLoad("STRATEGIC_PRIORITIES.md", "Strategic priorities", role)
      : Promise.resolve(undefined),
    request.operating_rhythm
      ? tryLoad("OPERATING_RHYTHM.md", "Operating rhythm", role)
      : Promise.resolve(undefined),
  ]);

  return {
    job_context: job,
    team_charter: charter,
    strategic_priorities: priorities,
    operating_rhythm: rhythm,
  };
}

async function tryLoad(
  filename: string,
  label: string,
  role: string,
): Promise<JobContextDoc | undefined> {
  const body = await readMyVoiceFile(filename).catch(() => null);
  if (!body) return undefined;
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  return { label, body: trimmed, role };
}

/**
 * Render a JobContextRefs object as a markdown block ready to drop
 * into an agent system prompt. Skips missing slices silently. Used
 * by agent system-prompt builders so each one can pick the same
 * rendering without duplicating the template.
 */
export function renderJobContextBlock(refs: JobContextRefs): string {
  const sections: string[] = [];
  const role = pickRole(refs);
  if (role) {
    sections.push(`# Your role\n\nYou are assisting a ${role}. Apply that lens to every interpretation below — focus on what applies to that role and de-prioritize what doesn't.`);
  }
  if (refs.job_context) sections.push(asSection(refs.job_context));
  if (refs.team_charter) sections.push(asSection(refs.team_charter));
  if (refs.strategic_priorities) sections.push(asSection(refs.strategic_priorities));
  if (refs.operating_rhythm) sections.push(asSection(refs.operating_rhythm));
  return sections.join("\n\n");
}

function asSection(doc: JobContextDoc): string {
  return `# ${doc.label}\n\n${doc.body}`;
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
