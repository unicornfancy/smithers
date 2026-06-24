// Shared types for the agents package.

export type AgentName =
  | "morning-briefing"
  | "ping-monitor"
  | "draft-from-task"
  | "draft-zendesk-reply"
  | "draft-p2-update"
  | "incorporate-reference"
  | "weekly-update"
  | "compose-weekly-update"
  | "top-3"
  | "realistic-shape"
  | "summarize-thread"
  | "suggest-next-step"
  | "compose-followup-nudge"
  | "compose-call-recap"
  | "analyze-call-transcript"
  | "learn-style-from-archives"
  | "run-skill"
  | "suggest-weekly-highlights"
  | "interpret-palette-query"
  | "compose-sitrep"
  | "compose-afk-notes";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentRuntimeOptions {
  /** Anthropic API key. Required at call time; not stored on disk. */
  apiKey: string;
  /** Model ID. Defaults to `claude-opus-4-7`. */
  model?: string;
  /** Effort. Defaults to `high`. */
  effort?: EffortLevel;
}

export interface AgentResult<TOutput = unknown> {
  agent: AgentName;
  /** Parsed structured output (one shape per agent). */
  output: TOutput;
  /** Free-text reasoning the model surfaced alongside the output, when present. */
  reasoning?: string;
  /** Token + cost telemetry. */
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  /** The exact model that responded. */
  model: string;
}

/** A simple style-guide reference passed into prompts. */
export interface StyleReference {
  /** Short label (e.g. "Katie's writing style"). */
  label: string;
  /** Markdown body of the style guide. */
  body: string;
}

/**
 * Job-context references — the per-agent declared-dependency channel.
 * Agents that opt in receive whichever slices the caller chose to load
 * (typically via `loadJobContext({...})`) and render them into their
 * system prompts. Unlike StyleReference (one voice file passed
 * everywhere), each agent declares which slices it needs so prompts
 * don't bloat with irrelevant context.
 */
export interface JobContextRefs {
  /** Who the user is, what the team does, the role description. */
  job_context?: JobContextDoc;
  /** Team charter — the scoring rubric, auto-synced from a shared Google Sheet. */
  team_charter?: JobContextDoc;
  /** Strategic priorities — what's important right now, hand-curated. */
  strategic_priorities?: JobContextDoc;
  /** Operating rhythm — cadence, formats, SLAs, stall thresholds. */
  operating_rhythm?: JobContextDoc;
}

export interface JobContextDoc {
  /** Short label rendered above the body in the prompt. */
  label: string;
  /** Markdown body of the doc. */
  body: string;
  /** Optional caller's role — agents weigh charter rows by this. */
  role?: string;
}
