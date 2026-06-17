import type { SwrCache } from "../cache";
import type { ResolvedMcpClientOptions } from "../config";
import type { HealthRegistry } from "../health";

import { MockGoogleDriveTransport } from "./mock";
import { RealGoogleDriveTransport } from "./real";
import type { GoogleDriveClient } from "./types";

export function createGoogleDriveClient(
  opts: ResolvedMcpClientOptions,
  cache: SwrCache,
  health: HealthRegistry,
): GoogleDriveClient {
  if (opts.mockGoogleDrive) {
    return new MockGoogleDriveTransport();
  }
  return new RealGoogleDriveTransport(opts, cache, health);
}

export type { GoogleDriveClient, DriveFolderActivityQuery } from "./types";
