import * as React from "react";

import { cn } from "@/lib/utils";

export function PageShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PlaceholderCard({
  title,
  description,
  todo,
}: {
  title: string;
  description: string;
  todo?: string[];
}) {
  return (
    <div className="bg-card flex flex-col gap-4 rounded-xl border p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {todo && todo.length > 0 ? (
        <div className="bg-muted/50 rounded-lg border-l-2 border-primary/40 p-4">
          <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
            Coming soon
          </p>
          <ul className="text-foreground/90 list-disc space-y-1 pl-5 text-sm">
            {todo.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
