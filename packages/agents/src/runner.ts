import Anthropic from "@anthropic-ai/sdk";

import { DEFAULT_EFFORT, DEFAULT_MODEL, getAnthropicClient } from "./client";
import type {
  AgentName,
  AgentResult,
  AgentRuntimeOptions,
  EffortLevel,
} from "./types";

export interface RunAgentOptions<TOutput> {
  /** Stable name; used in telemetry + cache keys. */
  agent: AgentName;
  /** System prompt — kept stable across calls so prompt caching works. */
  system: string;
  /** Per-call user prompt. */
  user: string;
  /**
   * JSON Schema describing the structured output. The model is constrained
   * to produce exactly this shape, so the result is parseable without
   * hand-written validation.
   */
  outputSchema: Record<string, unknown>;
  /** Hint for the parser — used in error messages only. */
  outputName: string;
  /** Per-agent override for effort. Defaults to runtime default ("high"). */
  effort?: EffortLevel;
  /**
   * Whether to enable adaptive thinking. Defaults to false for simple
   * drafting agents. Set true for analytical work (Top 3, stalls, briefings).
   */
  thinking?: boolean;
  /**
   * Cap on output tokens. 4096 is plenty for short drafts; bump up for
   * long-form work. Defaults to 4096.
   */
  maxTokens?: number;
  /** Result-shape validator — narrows the parsed JSON to TOutput. */
  validate: (raw: unknown) => TOutput;
}

/**
 * Run an agent end-to-end: render the prompt, call Claude with structured
 * output, validate the response, and return a typed result.
 *
 * The runner is intentionally non-streaming for v1 — agent outputs are
 * short enough (drafts, nudges, summaries) that the latency win from
 * streaming doesn't justify the UI complexity. Add streaming when an
 * agent emits long-form content.
 */
export async function runAgent<TOutput>(
  runtime: AgentRuntimeOptions,
  opts: RunAgentOptions<TOutput>,
): Promise<AgentResult<TOutput>> {
  const client = getAnthropicClient(runtime);
  const model = runtime.model ?? DEFAULT_MODEL;
  const effort = opts.effort ?? runtime.effort ?? DEFAULT_EFFORT;
  const maxTokens = opts.maxTokens ?? 4096;

  // The Claude SDK's typed namespace doesn't yet cover the structured-output
  // `format` shape on `output_config`, so we drop into the loosely-typed
  // request shape for that one field. The rest of the payload stays typed.
  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: {
      effort,
      format: {
        type: "json_schema",
        schema: opts.outputSchema,
      },
    } as unknown as Anthropic.MessageCreateParamsNonStreaming["output_config"],
    thinking: opts.thinking
      ? { type: "adaptive", display: "summarized" }
      : { type: "disabled" },
  };

  let response: Anthropic.Message;
  try {
    response = await client.messages.create(request);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error(
        `Anthropic API rejected the API key. Set ANTHROPIC_API_KEY in .env.local at the repo root.`,
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error(
        `Anthropic API rate limit hit. Wait a moment and try again.`,
      );
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Anthropic API error (${err.status}): ${err.message}`);
    }
    throw err;
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!textBlock) {
    throw new Error(
      `Agent "${opts.agent}" returned no text block. stop_reason=${response.stop_reason}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new Error(
      `Agent "${opts.agent}" returned non-JSON output despite structured-output schema. ` +
        `Output: ${textBlock.text.slice(0, 200)}`,
    );
  }

  let validated: TOutput;
  try {
    validated = opts.validate(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Agent "${opts.agent}" output didn't match expected ${opts.outputName} shape: ${message}`,
    );
  }

  // Surface adaptive-thinking reasoning when the agent asked for it.
  const thinkingBlock = response.content.find(
    (b): b is Anthropic.ThinkingBlock => b.type === "thinking",
  );

  return {
    agent: opts.agent,
    output: validated,
    reasoning: thinkingBlock?.thinking || undefined,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens:
        response.usage.cache_creation_input_tokens ?? undefined,
      cache_read_input_tokens:
        response.usage.cache_read_input_tokens ?? undefined,
    },
    model: response.model,
  };
}
