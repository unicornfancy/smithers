"use client";

import * as React from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  isoWeek: string;
  /** Short label like "Friday afternoon" / "Monday morning" — drives the prompt copy. */
  windowLabel: string;
}

/**
 * Friday-PM / Monday-AM nudge to capture this week's highlight before
 * the week rolls. Dismissal is per-iso_week in localStorage — once
 * dismissed for a given week, it won't reappear that week even if the
 * page reloads.
 */
export function HighlightBanner({ isoWeek, windowLabel }: Props) {
  const storageKey = `smithers_digest_banner_dismissed_${isoWeek}`;
  const [hidden, setHidden] = React.useState(true);

  React.useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem(storageKey);
      setHidden(dismissed === "1");
    } catch {
      setHidden(false);
    }
  }, [storageKey]);

  if (hidden) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // ignore
    }
    setHidden(true);
  }

  return (
    <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20">
      <CardContent className="flex items-center gap-3 py-3">
        <Sparkles className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            Capture this week&apos;s highlight ({isoWeek})
          </p>
          <p className="text-muted-foreground text-xs">
            It&apos;s {windowLabel}. Worth a minute to jot what stood out before
            it blurs.
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/digest">Open digest</Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          <X className="size-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
