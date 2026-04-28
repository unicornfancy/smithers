import * as React from "react";

import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-muted/30 flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center",
        className,
      )}
    >
      <h3 className="text-foreground text-base font-semibold">{title}</h3>
      <p className="text-muted-foreground max-w-md text-sm">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function VaultMissingNotice({ vaultPath }: { vaultPath: string }) {
  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 border-amber-200 dark:border-amber-900/50 flex flex-col gap-1 rounded-md border px-4 py-3 text-sm">
      <p className="font-medium">Vault not found</p>
      <p className="text-amber-800/80 dark:text-amber-100/70 text-xs">
        Smithers couldn't find a vault at{" "}
        <code className="bg-amber-100 dark:bg-amber-900/50 rounded px-1 py-0.5 text-[11px]">
          {vaultPath}
        </code>
        . Run the setup wizard to point at the right folder.
      </p>
    </div>
  );
}
