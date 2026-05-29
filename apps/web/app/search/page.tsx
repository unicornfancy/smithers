import { ExternalLink, Search as SearchIcon, ShieldAlert } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/page-shell";
import { SearchInput } from "@/components/search-input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMcpClient } from "@/lib/server/mcp";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "Search · Smithers",
};

export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const vault = await getVault();
  const hiveMindPath = vault.options.hiveMindPath ?? null;

  let hits: Awaited<ReturnType<typeof runSearch>> | null = null;
  if (query) {
    hits = await runSearch(query);
  }

  return (
    <>
      <AppHeader
        title="Search Hive Mind"
        subtitle="Free-text across every partner-knowledge.md, project info.md, brief, and note in the HM clone."
      />
      <PageShell>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <SearchIcon className="text-muted-foreground size-4" />
              Query
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SearchInput initialQuery={query} />
            {!hiveMindPath ? (
              <p className="text-muted-foreground mt-2 text-xs">
                Hive Mind path isn&apos;t configured —{" "}
                <a href="/settings?tab=setup" className="underline">
                  set it in Setup
                </a>{" "}
                to enable search.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {hits ? (
          hits.ok ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  Results
                  <span className="text-muted-foreground ml-auto text-xs font-normal">
                    {hits.data.length} hit{hits.data.length === 1 ? "" : "s"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {hits.data.length === 0 ? (
                  <p className="text-muted-foreground text-sm italic">
                    No matches for {`"${query}"`}.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y">
                    {hits.data.map((hit) => (
                      <li
                        key={hit.path}
                        className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0"
                      >
                        <div className="flex items-baseline gap-2">
                          <a
                            href={
                              hiveMindPath
                                ? `file://${hiveMindPath}/${hit.path}`
                                : "#"
                            }
                            className="text-foreground hover:underline inline-flex items-center gap-1.5 text-sm font-medium"
                          >
                            {hit.title}
                            <ExternalLink className="size-3 opacity-60" />
                          </a>
                          {hit.nda ? (
                            <Badge
                              variant="outline"
                              className="gap-1 text-[10px] uppercase"
                            >
                              <ShieldAlert className="size-3" />
                              NDA
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-muted-foreground text-xs leading-snug">
                          {hit.excerpt}
                        </p>
                        <code className="text-muted-foreground/70 font-mono text-[10px]">
                          {hit.path}
                        </code>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-4">
                <p className="text-destructive text-sm">{hits.error}</p>
              </CardContent>
            </Card>
          )
        ) : null}
      </PageShell>
    </>
  );
}

async function runSearch(
  query: string,
): Promise<
  | { ok: true; data: Awaited<ReturnType<typeof callSearch>> }
  | { ok: false; error: string }
> {
  try {
    const data = await callSearch(query);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Search failed",
    };
  }
}

async function callSearch(query: string) {
  const mcp = await getMcpClient();
  const result = await mcp.hiveMind.searchKnowledge({ query, limit: 20 });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}
