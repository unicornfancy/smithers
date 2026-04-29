// @smithers/agents — prompt templates + Anthropic SDK runner.
//
// Each agent is a typed function (input → AgentResult<output>) backed by
// a stable system prompt and a JSON schema. The runner enforces the
// schema via the Messages API's structured-output mode, so callers get
// validated objects, not free-form text to parse.
//
// Usage from app code:
//
//   import { composeFollowUpNudge } from "@smithers/agents";
//   const result = await composeFollowUpNudge(
//     { apiKey: process.env.ANTHROPIC_API_KEY! },
//     { followUp, project, daysWaiting: 12 },
//   );

export const AGENTS_PACKAGE_VERSION = "0.0.2";

export type {
  AgentName,
  AgentResult,
  AgentRuntimeOptions,
  EffortLevel,
  StyleReference,
} from "./types";

export {
  composeFollowUpNudge,
  type ComposeNudgeInput,
  type ComposeNudgeOutput,
  type NudgeChannel,
  type NudgeTone,
} from "./agents/compose-followup-nudge";

export {
  composeTopThree,
  type ComposeTopThreeInput,
  type TopThreeCandidateInput,
  type TopThreeOutput,
  type TopThreePick,
} from "./agents/top-three";

export {
  composeRealisticShape,
  type RealisticShapeInput,
  type RealisticShapeOutput,
} from "./agents/realistic-shape";
