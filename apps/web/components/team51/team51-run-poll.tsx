"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * While a team51 run is queued/running, poll every 3s so the detail
 * page transitions to completed/failed as soon as the postback fires.
 * Cheaper than a websocket for this low-frequency signal.
 */
export function Team51RunPoll() {
  const router = useRouter();
  React.useEffect(() => {
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
