// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SearchIcon } from "lucide-react";
import { SeverityBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { packageHref } from "@/lib/package-href";
import type { Severity } from "@/lib/pb/types";
import { cn } from "@/lib/utils";

export interface PackageRow {
  name: string;
  version: string;
  direct: boolean;
  dev: boolean;
  via: string[];
  severity: Severity | null;
  vulnCount: number;
  latest?: string;
  outdated?: "major" | "minor" | "patch" | null;
}

type Filter = "all" | "direct" | "dev" | "vulnerable";
const LIMIT = 300;

export function PackagesTable({ rows }: { rows: PackageRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);

  const counts = useMemo(
    () => ({
      all: rows.length,
      direct: rows.filter((r) => r.direct).length,
      dev: rows.filter((r) => r.dev).length,
      vulnerable: rows.filter((r) => r.vulnCount > 0).length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "direct" && !r.direct) return false;
      if (filter === "dev" && !r.dev) return false;
      if (filter === "vulnerable" && r.vulnCount === 0) return false;
      return !q || r.name.toLowerCase().includes(q);
    });
  }, [rows, query, filter]);

  const visible = showAll ? filtered : filtered.slice(0, LIMIT);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search packages"
            className="pl-8"
            aria-label="Search packages"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(["all", "direct", "dev", "vulnerable"] as Filter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "secondary" : "ghost"}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className="capitalize"
            >
              {f}
              <span className="text-muted-foreground tabular-nums">{counts[f]}</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Package</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden md:table-cell">Pulled in by</TableHead>
              <TableHead className="text-right">Advisories</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No packages match.
                </TableCell>
              </TableRow>
            )}
            {visible.map((r) => (
              <TableRow key={`${r.name}@${r.version}`}>
                <TableCell className="font-mono text-[13px]">
                  <Link href={packageHref(r.name)} className="hover:underline" title="Show in all projects">
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-[13px]">
                  {r.version}
                  {r.latest && r.outdated && (
                    <span
                      className={cn(
                        "ml-2 text-xs",
                        r.outdated === "major" ? "text-warn" : "text-muted-foreground",
                      )}
                      title={`Latest published version: ${r.latest}`}
                    >
                      → {r.latest}
                      <span className="ml-1 rounded bg-muted px-1 py-0.5 font-sans text-[10px] tracking-wide uppercase">
                        {r.outdated}
                      </span>
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.direct ? "direct" : "transitive"}
                  {r.dev && <span className="ml-1.5 rounded bg-muted px-1 py-0.5">dev</span>}
                </TableCell>
                <TableCell className="hidden max-w-64 truncate font-mono text-xs text-muted-foreground md:table-cell">
                  {r.direct ? "" : r.via.join(", ")}
                </TableCell>
                <TableCell className="text-right">
                  {r.severity ? (
                    <span className="inline-flex items-center gap-1.5">
                      <SeverityBadge severity={r.severity} />
                      {r.vulnCount > 1 && (
                        <span className="text-xs text-muted-foreground">×{r.vulnCount}</span>
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
      {!showAll && filtered.length > LIMIT && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {LIMIT} of {filtered.length}. Refine the search, or
          </span>
          <Button size="sm" variant="outline" onClick={() => setShowAll(true)}>
            Show all
          </Button>
        </div>
      )}
    </div>
  );
}
