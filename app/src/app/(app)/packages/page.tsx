// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { SeverityBadge } from "@/components/status";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPackages, PACKAGE_SCOPES, type PackageScope } from "@/lib/data/packages";
import { packageHref } from "@/lib/package-href";
import { SearchBox } from "./search-box";

export const metadata: Metadata = { title: "Packages" };

const LIMIT = 200;
const SCOPE_LABEL: Record<PackageScope, string> = { direct: "Direct", all: "All", vulnerable: "Vulnerable" };

function scopeHref(scope: PackageScope, q: string): string {
  const params = new URLSearchParams();
  if (scope !== "direct") params.set("scope", scope);
  if (q) params.set("q", q);
  const search = params.toString();
  return search ? `/packages?${search}` : "/packages";
}

export default async function PackagesPage({ searchParams }: PageProps<"/packages">) {
  const params = await searchParams;
  const q = String(params.q ?? "")
    .trim()
    .slice(0, 214);
  const scope = PACKAGE_SCOPES.find((s) => s === params.scope) ?? "direct";
  const { packages, counts } = await listPackages(q, scope);
  const shown = packages.slice(0, LIMIT);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Packages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every npm package in your projects&rsquo; lockfiles. Open one to see which projects use it, in which
          version, and why.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBox initial={q} />
        <nav className="flex flex-wrap gap-1" aria-label="Show">
          {PACKAGE_SCOPES.map((s) => (
            <Link
              key={s}
              href={scopeHref(s, q)}
              scroll={false}
              className={buttonVariants({ size: "sm", variant: s === scope ? "secondary" : "ghost" })}
              aria-current={s === scope ? "page" : undefined}
            >
              {SCOPE_LABEL[s]}
              <span className="text-muted-foreground tabular-nums">{counts[s]}</span>
            </Link>
          ))}
        </nav>
      </div>

      {counts.all === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">{q ? `No package matching “${q}”` : "No packages yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {q
              ? "Packages come from the lockfiles your builds report. Check the spelling, or search for part of the name."
              : "They appear here after the first build reports its lockfile."}
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">
            {scope === "vulnerable" ? "No open advisories" : "No direct dependency matches"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {counts.all} package{counts.all === 1 ? "" : "s"} in{" "}
            <Link href={scopeHref("all", q)} className="underline underline-offset-4 hover:text-foreground">
              All
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead>Versions in use</TableHead>
                  <TableHead className="text-right">Projects</TableHead>
                  <TableHead className="text-right">Advisories</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((p) => (
                  <TableRow key={p.name} className="relative">
                    <TableCell className="font-mono text-[13px]">
                      {/* The link covers the row, so the whole row opens the package. */}
                      <Link href={packageHref(p.name)} className="font-medium after:absolute after:inset-0">
                        {p.name}
                      </Link>
                      {!p.direct && scope !== "direct" && (
                        <span className="ml-2 font-sans text-xs text-muted-foreground">transitive</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[13px] text-muted-foreground">
                      {p.versions.slice(0, 3).join(", ")}
                      {p.versions.length > 3 && (
                        <span className="font-sans text-xs"> +{p.versions.length - 3}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.projects}</TableCell>
                    <TableCell className="text-right">
                      {p.severity ? (
                        <span className="inline-flex items-center gap-1.5">
                          <SeverityBadge severity={p.severity} />
                          {p.advisories > 1 && (
                            <span className="text-xs text-muted-foreground">×{p.advisories}</span>
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
          {packages.length > shown.length && (
            <p className="text-sm text-muted-foreground">
              Showing {shown.length} of {packages.length}. Filter by name to narrow it down.
            </p>
          )}
        </>
      )}
    </div>
  );
}
