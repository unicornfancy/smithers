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
  | "run-skill";

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
