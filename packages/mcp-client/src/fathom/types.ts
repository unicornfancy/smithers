// Public types for the Fathom client.

import type { CallRecordingRef, SourceResult } from "../types";

export interface RecordingsQuery {
  /** Cap on results returned. Defaults to 20. */
  limit?: number;
  /** ISO date; only recordings at-or-after this point. */
  since?: string;
}

export interface FathomClient {
  listRecordings(
    query: RecordingsQuery,
  ): Promise<SourceResult<CallRecordingRef[]>>;
}
