"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";

interface Props {
  initialQuery: string;
}

/**
 * Client wrapper for the Hive Mind search input. Submits update the
 * URL's `?q=` so refresh / share / back-button all work, and the
 * server page re-renders with fresh results.
 */
export function SearchInput({ initialQuery }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = React.useState(initialQuery);

  // Sync local state if the URL changes externally (back/forward).
  React.useEffect(() => {
    const q = params.get("q") ?? "";
    setValue(q);
  }, [params]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    const next = new URLSearchParams();
    if (trimmed) next.set("q", trimmed);
    const qs = next.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          placeholder="Search Hive Mind — partner names, project topics, ticket subjects…"
          className="border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-1"
        />
      </div>
      <Button type="submit" size="sm" className="h-10">
        Search
      </Button>
    </form>
  );
}
