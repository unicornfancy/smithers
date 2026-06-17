import type { ActivityEvent, SourceResult } from "../types";

import type { DriveFolderActivityQuery, GoogleDriveClient } from "./types";

/**
 * No-op transport. Returns an empty fresh result so the workbench feed
 * gracefully shows "no Drive activity" until real credentials are
 * configured. Use `mockGoogleDrive: false` + both path env vars to
 * switch to the real transport.
 */
export class MockGoogleDriveTransport implements GoogleDriveClient {
  async listFolderActivity(
    _query: DriveFolderActivityQuery,
  ): Promise<SourceResult<ActivityEvent[]>> {
    return {
      ok: true,
      data: [],
      from: "fresh",
      fetched_at: new Date().toISOString(),
    };
  }
}
