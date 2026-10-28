// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowSquareOutIcon, CaretLeftIcon } from "@phosphor-icons/react/ssr";
import { SeverityBadge } from "@/components/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { packageDetail } from "@/lib/data/packages";
import { outdatedLevel } from "@/lib/npm-latest";
import { packageNameFromSegments } from "@/lib/package-href";
import { cn } from "@/lib/utils";
import { requireUser } from "@/lib/auth/session";

export async function generateMetadata({ params }: PageProps<"/packages/[...name]">): Promise<Metadata> {
  return { title: packageNameFromSegments((await params).name) };
}

export default async function PackagePage({ params }: PageProps<"/packages/[...name]">) {
  await requireUser();
  const name = packageNameFromSegments((await params).name);
  const pkg = await packageDetail(name);
  if (!pkg) notFound();

  const projects = new Set(pkg.usages.map((u) => u.project.id)).size;
  const vulnerable = new Set(pkg.usages.filter((u) => u.severity).map((u) => u.version));
  const perVersion = pkg.versions.map((v) => ({
    version: v,
    projects: new Set(pkg.usages.filter((u) => u.version === v).map((u) => u.project.id)).size,
  }));

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/packages"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <CaretLeftIcon className="size-4" /> Packages
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="font-display text-3xl font-bold tracking-tight break-all">{pkg.name}</h1>
          {pkg.ecosystem === "npm" && (
            <a
              href={`https://www.npmjs.com/package/${pkg.name}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              npm <ArrowSquareOutIcon className="size-3.5" />
            </a>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Used by {projects} project{projects === 1 ? "" : "s"} in {pkg.versions.length} version
          {pkg.versions.length === 1 ? "" : "s"}
          {pkg.latest && (
            <>
              {" "}
              · latest on npm <span className="font-mono text-foreground">{pkg.latest}</span>
            </>
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {perVersion.map((v) => (
            <span
              key={v.version}
              className={cn(
                "rounded-md border px-2 py-0.5 font-mono text-xs",
                vulnerable.has(v.version) && "border-danger/40 bg-danger/5 text-danger",
              )}
            >
              {v.version}{" "}
              <span className="font-sans text-muted-foreground">
                {v.projects} project{v.projects === 1 ? "" : "s"}
              </span>
            </span>
          ))}
        </div>
      </div>

      {pkg.advisories.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-medium">Advisories</h2>
          <ul className="divide-y rounded-xl border">
            {pkg.advisories.map((a) => (
              <li key={a.osvId} className={cn("space-y-1 p-4", a.ignored && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={a.severity} />
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-sm hover:underline"
                  >
                    {a.osvId} <ArrowSquareOutIcon className="size-3.5 text-muted-foreground" />
                  </a>
                  {a.ignored && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">ignored</span>}
                </div>
                {a.summary && <p className="text-sm">{a.summary}</p>}
                <p className="text-sm text-muted-foreground">
                  Affects <span className="font-mono">{a.versions.join(", ")}</span> in{" "}
                  {a.projects.map((p, i) => (
                    <span key={p.slug}>
                      {i > 0 && ", "}
                      <Link href={`/projects/${p.slug}`} className="text-foreground hover:underline">
                        {p.name}
                      </Link>
                    </span>
                  ))}
                  {a.fixedIn ? (
                    <>
                      {" "}
                      · fixed in <span className="font-mono text-foreground">{a.fixedIn}</span>
                    </>
                  ) : (
                    " · no fixed version yet"
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-medium">Where it is used</h2>
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
              {pkg.usages.map((u) => {
                const outdated = outdatedLevel(u.version, pkg.latest);
                return (
                  <TableRow key={`${u.project.id}-${u.version}`} className="relative">
                    <TableCell>
                      <Link
                        href={`/projects/${u.project.slug}?tab=packages`}
                        className="font-medium after:absolute after:inset-0"
                      >
                        {u.project.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-[13px]">
                      {u.version}
                      {outdated && (
                        <span
                          className={cn(
                            "ml-2 rounded bg-muted px-1 py-0.5 font-sans text-[10px] tracking-wide uppercase",
                            outdated === "major" ? "text-warn" : "text-muted-foreground",
                          )}
                          title={`Latest published version: ${pkg.latest}`}
                        >
                          {outdated}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.direct ? "direct" : "transitive"}
                      {u.dev && <span className="ml-1.5 text-quiet">dev</span>}
                    </TableCell>
                    <TableCell className="hidden max-w-72 truncate font-mono text-xs text-muted-foreground md:table-cell">
                      {u.direct ? "" : u.via.join(", ")}
                    </TableCell>
                    <TableCell className="text-right">
                      {u.severity ? (
                        <span className="inline-flex items-center gap-1.5">
                          <SeverityBadge severity={u.severity} quiet={u.dev} />
                          {u.advisories > 1 && (
                            <span className="text-xs text-muted-foreground">×{u.advisories}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">none</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
