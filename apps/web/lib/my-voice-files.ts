// Ordered list of my-voice skill files. Kept in a plain (non-server) module
// so both server helpers and client components can import it.

export const MY_VOICE_FILES: readonly { filename: string; label: string }[] = [
  { filename: "SKILL.md", label: "Voice & Style" },
  { filename: "PARTNER_COMMS.md", label: "Partner Comms" },
  { filename: "INTERNAL_STYLE_GUIDE.md", label: "Internal Style" },
  { filename: "EXTERNAL_STYLE_GUIDE.md", label: "External Style" },
  { filename: "REPORT_STRUCTURE.md", label: "Report Structure" },
  { filename: "WEEKLY_UPDATE_STYLE.md", label: "Weekly Update Style" },
  // Job context — who the user is, what their team does, common
  // collaborators + vocabulary. Loaded by every voice-aware agent
  // alongside the style files. Written to be partner-safe in v1 so it
  // can ride along with partner-facing drafts; split into
  // INTERNAL_/EXTERNAL_JOB_CONTEXT later if leakage becomes a concern.
  { filename: "JOB_CONTEXT.md", label: "Job Context" },
  // Team charter — what the user is evaluated on. Auto-synced from a
  // shared Google Sheet so the rubric stays current. The full sheet
  // tab is rendered as a markdown table; the consuming agents weigh
  // rows by identity.role at prompt time (we don't pre-filter so new
  // role-relevant metrics surface without re-touching the sync code).
  { filename: "TEAM_CHARTER.md", label: "Team Charter" },
  // Strategic priorities — what's important right now. Hand-curated,
  // typically updated quarterly. Loaded by Top 3 / For You / Realistic
  // Shape agents so they bias toward the season's emphasis.
  { filename: "STRATEGIC_PRIORITIES.md", label: "Strategic Priorities" },
  // Operating rhythm — call cadence, weekly update format, follow-up
  // SLAs, stall thresholds, launch process. Hand-curated, updated when
  // team processes change. Loaded by weekly-update generators + Today
  // ranking so they know what's "stalled" vs "active" by role norms.
  { filename: "OPERATING_RHYTHM.md", label: "Operating Rhythm" },
] as const;
