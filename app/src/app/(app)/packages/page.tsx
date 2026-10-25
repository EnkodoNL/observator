// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { SeverityBadge } from "@/components/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { popularPackages, searchPackages } from "@/lib/data/packages";
import { SearchBox } from "./search-box";

export const metadata: Metadata = { title: "Packages" };

export default async function PackagesPage({ searchParams }: PageProps<"/packages">) {
  const q = String((await searchParams).q ?? "").slice(0, 214);
  const [{ results, truncated }, popular] = await Promise.all([
    searchPackages(q),
    q ? Promise.resolve([]) : popularPackages(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Packages</h1>
        <p className="mt-1 text-sm text-muted-foreground">Where is a package used, and in which version?</p>
      </div>
      <SearchBox initial={q} />

      {!q && popular.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Most used direct dependencies</h2>
          <div className="flex flex-wrap gap-1.5">
            {popular.map((p) => (
              <Link
                key={p.name}
                href={`/packages?q=${encodeURIComponent(p.name)}`}
                className="rounded-md border px-2 py-1 font-mono text-xs transition-colors hover:bg-muted"
              >
                {p.name} <span className="text-muted-foreground">{p.projects}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {q && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No project uses a package matching &ldquo;{q}&rdquo;.</p>
      )}

      {results.map((r) => (
        <section key={r.name} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-mono text-base font-medium">{r.name}</h2>
            <span className="text-sm text-muted-foreground">
              {r.usages.length} use{r.usages.length === 1 ? "" : "s"} · {r.versions.length} version
              {r.versions.length === 1 ? "" : "s"}: <span className="font-mono">{r.versions.join(", ")}</span>
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden md:table-cell">Pulled in by</TableHead>
                  <TableHead className="text-right">Advisories</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.usages.map((u) => (
                  <TableRow key={`${u.project.id}-${u.version}`}>
                    <TableCell>
                      <Link href={`/projects/${u.project.slug}?tab=packages`} className="hover:underline">
                        {u.project.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-[13px]">{u.version}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.direct ? "direct" : "transitive"}
                      {u.dev && <span className="ml-1.5 rounded bg-muted px-1 py-0.5">dev</span>}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                      {u.direct ? "" : u.via.join(", ")}
                    </TableCell>
                    <TableCell className="text-right">
                      {u.severity ? (
                        <span className="inline-flex items-center gap-1.5">
                          <SeverityBadge severity={u.severity} />
                          {u.advisories > 1 && (
                            <span className="text-xs text-muted-foreground">×{u.advisories}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">none</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ))}
      {truncated && (
        <p className="text-sm text-muted-foreground">
          Showing the first matches. Narrow the search for more.
        </p>
      )}
    </div>
  );
}
