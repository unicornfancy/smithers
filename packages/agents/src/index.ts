// @smithers/agents — prompt templates + Claude/Anthropic runner.
//
// Implementation lands as part of the `agents_runtime` todo. This stub keeps
// the package importable and the workspace graph wired.

export const AGENTS_PACKAGE_VERSION = "0.0.1";

export type AgentName =
  | "morning-briefing"
  | "ping-monitor"
  | "draft-from-task"
  | "incorporate-reference"
  | "weekly-update"
  | "top-3"
  | "realistic-shape"
  | "summarize-thread"
  | "suggest-next-step"
  | "compose-followup-nudge";
