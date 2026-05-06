// Linear client factory.

import type { ResolvedMcpClientOptions } from "../config";
import { MockLinearTransport } from "./mock";
import { RealLinearTransport } from "./real";
import type { LinearClient } from "./types";

export function createLinearClient(
  opts: ResolvedMcpClientOptions,
): LinearClient {
  if (opts.mockLinear) {
    return new MockLinearTransport();
  }
  return new RealLinearTransport();
}

export type {
  LinearClient,
  LinearProject,
  LinearProjectSummary,
  LinearIssue,
  LinearIssueDetail,
  LinearProjectUpdate,
} from "./types";
