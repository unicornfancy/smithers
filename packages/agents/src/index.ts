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
  JobContextDoc,
  JobContextRefs,
  StyleReference,
} from "./types";

export {
  attachJobContext,
  renderJobContextForPrompt,
} from "./job-context";

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

export {
  suggestNextStep,
  type SuggestNextStepInput,
  type SuggestNextStepOutput,
  type SuggestNextStepPick,
  type SuggestNextStepCtaTarget,
  type SuggestNextStepZendeskThread,
} from "./agents/suggest-next-step";

export {
  draftZendeskReply,
  type DraftZendeskReplyInput,
  type DraftZendeskReplyOutput,
  type ZendeskReplyContext,
  type ZendeskReplyTone,
} from "./agents/draft-zendesk-reply";

export {
  summarizeZendeskThread,
  type SummarizeZendeskThreadComment,
  type SummarizeZendeskThreadInput,
  type SummarizeZendeskThreadOutput,
} from "./agents/summarize-zendesk-thread";

export {
  runHiveMindSkill,
  type RunSkillInput,
  type RunSkillOutput,
} from "./agents/run-skill";

export {
  analyzeCallTranscript,
  getDefaultAnalyzeCallTranscriptPrompt,
  type AnalyzeCallTranscriptInput,
  type AnalyzeCallTranscriptOutput,
  type CallActionItem,
  type CallFollowUp,
  type CallDecision,
  type CallKeyQuote,
} from "./agents/analyze-call-transcript";

export {
  draftP2Update,
  type DraftP2UpdateInput,
  type DraftP2UpdateOutput,
} from "./agents/draft-p2-update";

export {
  composeWeeklyUpdate,
  type WeeklyUpdateInput,
  type WeeklyUpdateOutput,
  type WeeklyUpdateProjectFacts,
} from "./agents/compose-weekly-update";

export {
  composeCallRecap,
  type ComposeCallRecapInput,
  type ComposeCallRecapOutput,
} from "./agents/compose-call-recap";

export {
  learnStyleFromArchives,
  type FileAddition,
  type LearnStyleFromArchivesInput,
  type LearnStyleFromArchivesOutput,
  type LearnStyleSample,
  type StylePattern,
} from "./agents/learn-style-from-archives";

export {
  chatAboutTranscript,
  type ChatAboutTranscriptInput,
  type ChatMessage as TranscriptChatMessage,
} from "./agents/chat-about-transcript";

export {
  EXTRA_CONTEXT_SYSTEM_PROMPT,
  renderExtraContextBlock,
  type DraftExtraContextItem,
} from "./extra-context";

export {
  interpretPaletteQuery,
  type InterpretPaletteQueryInput,
  type InterpretPaletteQueryOutput,
  type InterpretPaletteIntentKind,
  type InterpretPaletteEntry,
  type InterpretPaletteOpenTaskHint,
  type InterpretPaletteOpenFollowUpHint,
} from "./agents/interpret-palette-query";

export {
  suggestWeeklyHighlights,
  type HighlightCandidateInput,
  type HighlightCategory,
  type SuggestWeeklyHighlightsInput,
  type SuggestWeeklyHighlightsOutput,
  type WeeklyHighlightSuggestion,
} from "./agents/suggest-weekly-highlights";
