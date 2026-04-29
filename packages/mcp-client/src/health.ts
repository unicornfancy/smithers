// Per-source health tracking (Layer B + Layer F of the six-layer model).
//
// Every wrapped MCP call records its outcome here. The /settings → MCP Health
// panel reads from this registry; the app header's amber indicator turns on
// when any tracked source is `degraded` or `down`.

import type { McpError, McpSourceId, SourceHealth } from "./types";

export class HealthRegistry {
  private state = new Map<McpSourceId, SourceHealth>();

  recordSuccess(source: McpSourceId): void {
    const now = new Date().toISOString();
    this.state.set(source, {
      source,
      status: "ok",
      last_success_at: now,
      last_attempt_at: now,
      last_error: undefined,
      consecutive_failures: 0,
    });
  }

  recordFailure(source: McpSourceId, error: McpError): void {
    const now = new Date().toISOString();
    const prior = this.state.get(source);
    const failures = (prior?.consecutive_failures ?? 0) + 1;
    this.state.set(source, {
      source,
      status: failures >= 3 ? "down" : "degraded",
      last_success_at: prior?.last_success_at,
      last_attempt_at: now,
      last_error: error.message,
      consecutive_failures: failures,
    });
  }

  /** Snapshot of all known source health, sorted by source id for stable UI. */
  snapshot(): SourceHealth[] {
    return Array.from(this.state.values()).sort((a, b) =>
      a.source.localeCompare(b.source),
    );
  }

  get(source: McpSourceId): SourceHealth {
    return (
      this.state.get(source) ?? {
        source,
        status: "unknown",
        consecutive_failures: 0,
      }
    );
  }

  /** True when any source is degraded or down. Drives the header indicator. */
  hasIssues(): boolean {
    for (const h of this.state.values()) {
      if (h.status === "degraded" || h.status === "down") return true;
    }
    return false;
  }
}
