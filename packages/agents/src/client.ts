import Anthropic from "@anthropic-ai/sdk";

import type { AgentRuntimeOptions } from "./types";

export const DEFAULT_MODEL = "claude-opus-4-7";
export const DEFAULT_EFFORT = "high" as const;

let cached: { key: string; client: Anthropic } | null = null;

/**
 * Lazily-built Anthropic client, keyed by API key so a key change at
 * runtime (e.g. via /settings) creates a fresh client.
 */
export function getAnthropicClient(options: AgentRuntimeOptions): Anthropic {
  if (cached && cached.key === options.apiKey) return cached.client;
  const client = new Anthropic({ apiKey: options.apiKey });
  cached = { key: options.apiKey, client };
  return client;
}
