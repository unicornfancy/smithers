"use client";

import * as React from "react";

import type { SetupStatus } from "@/app/setup/actions";
import {
  ApiKeysSection,
  IdentitySection,
  McpsSection,
  PathsSection,
} from "@/components/setup-wizard";

interface Props {
  initialStatus: SetupStatus;
}

/**
 * Wraps the four /setup section components with a shared SetupStatus
 * state so a save in one card updates the badges in the others. Used
 * by /settings → Setup section to host the same fields the first-run
 * wizard exposes, without re-reading config on every keystroke.
 */
export function SettingsSetupGroup({ initialStatus }: Props) {
  const [status, setStatus] = React.useState(initialStatus);
  return (
    <div className="space-y-3">
      <IdentitySection status={status} setStatus={setStatus} />
      <PathsSection status={status} setStatus={setStatus} />
      <ApiKeysSection status={status} setStatus={setStatus} />
      <McpsSection status={status} setStatus={setStatus} />
    </div>
  );
}
