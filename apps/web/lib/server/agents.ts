import "server-only";

import type { AgentRuntimeOptions } from "@smithers/agents";

import { loadConfig } from "./config";

export interface AgentRuntimeStatus {
  configured: boolean;
  /** The env var name we expected to find the key in. */
  apiKeyEnv: string;
  /** Model + effort that will be used for agent calls. */
  model: string;
  effort: AgentRuntimeOptions["effort"];
}

/**
 * Resolve the agent runtime from config + environment.
 *
 * Returns null when the API key isn't set — callers should surface a
 * "configure ANTHROPIC_API_KEY" message instead of crashing.
 */
export async function getAgentRuntime(): Promise<AgentRuntimeOptions | null> {
  const cfg = await loadConfig();
  const apiKey = process.env[cfg.agents.api_key_env];
  if (!apiKey) return null;
  return {
    apiKey,
    model: cfg.agents.model,
    effort: cfg.agents.effort,
  };
}

/** Status check for UI surfaces (settings, "configure your key" CTAs). */
export async function getAgentRuntimeStatus(): Promise<AgentRuntimeStatus> {
  const cfg = await loadConfig();
  const apiKey = process.env[cfg.agents.api_key_env];
  return {
    configured: Boolean(apiKey),
    apiKeyEnv: cfg.agents.api_key_env,
    model: cfg.agents.model,
    effort: cfg.agents.effort,
  };
}
