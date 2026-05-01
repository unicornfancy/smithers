import * as React from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";

export function AppHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="bg-background/80 sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-base font-semibold leading-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="text-muted-foreground truncate text-xs leading-tight">
              {subtitle}
            </p>
          ) : null}
        </div>
        <Badge variant="outline" className="hidden sm:inline-flex">
          pre-alpha
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <ThemeToggle />
      </div>
    </header>
  );
}
