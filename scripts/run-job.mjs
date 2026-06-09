#!/usr/bin/env node
// scripts/run-job.mjs — manual one-shot job runner.
//
// Usage:  pnpm jobs:run-once <name>
//
// Names: morning-briefing | ping-monitor | transcription-sync | hive-mind-sync
//        (also accepts: fathom-sync — legacy alias for transcription-sync)
//
// This is a thin dispatcher; each job is implemented as its own module under
// scripts/jobs/<name>.mjs and imports from packages/agents and packages/mcp-client.
// Cross-platform fallback for users without launchd.

const job = process.argv[2];

if (!job) {
  console.error(
    "usage: pnpm jobs:run-once <morning-briefing|ping-monitor|transcription-sync|hive-mind-sync>",
  );
  process.exit(2);
}

const known = new Set([
  "morning-briefing",
  "ping-monitor",
  "transcription-sync",
  // Legacy alias kept so already-installed crontabs keep working.
  "fathom-sync",
  "hive-mind-sync",
]);

if (!known.has(job)) {
  console.error(`unknown job: ${job}`);
  console.error(`known jobs: ${[...known].join(", ")}`);
  process.exit(2);
}

console.log(`[smithers] running job: ${job}`);
console.log(
  `[smithers] (stub) implementation lands with the background_jobs todo`,
);
process.exit(0);
