// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { LabelChips } from "@/components/label-chips";
import { SEVERITY_TEXT, StatusBadge } from "@/components/status";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import {
  KIND_FILTERS,
  kindOf,
  projectList,
  STATUS_FILTERS,
  type KindFilter,
  type ProjectListFilter,
} from "@/lib/data/project-list";
import { getOverview } from "@/lib/data/views";
import { effectiveLabels } from "@/lib/labels";
import type { Severity } from "@/lib/pb/types";
import { primaryRuntime, runtimeLabel } from "@/lib/runtimes/labels";
import { severityRank } from "@/lib/severity";
import { STATUS_LABEL, type ProjectStatus } from "@/lib/status";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { SearchBox } from "../packages/search-box";

export const metadata: Metadata = { title: "Projects" };

const KIND_LABEL: Record<KindFilter, string> = {
  all: "All",
  apps: "Apps",
  databases: "Databases",
  services: "Services",
};

/** /projects with these filters; the ones at their default are left out. */
function projectsHref(f: ProjectListFilter): string {
  const params = new URLSearchParams();
  if (f.kind !== "all") params.set("kind", f.kind);
  if (f.status) params.set("status", f.status);
  if (f.q) params.set("q", f.q);
  for (const l of f.labels) params.append("label", l);
  const search = params.toString();
  return search ? `/projects?${search}` : "/projects";
}

/** "2 high · 1 moderate", worst first. */
function advisoryText(counts: Partial<Record<Severity, number>>): { text: string; worst: Severity } | null {
  const entries = (Object.entries(counts) as [Severity, number][])
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => severityRank(b) - severityRank(a));
  if (!entries.length) return null;
  return { text: entries.map(([s, n]) => `${n} ${s}`).join(" · "), worst: entries[0][0] };
}

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  await requireUser();
  const params = await searchParams;
  const filter: ProjectListFilter = {
    kind: KIND_FILTERS.find((k) => k === params.kind) ?? "all",
    status: STATUS_FILTERS.find((s) => s === params.status) ?? null,
    q: String(params.q ?? "")
      .trim()
      .slice(0, 100),
    labels: [params.label ?? []].flat().map(String),
  };
  const items = await getOverview();
  const { rows, counts } = projectList(items, filter);
  const allLabels = [...new Set(items.flatMap((i) => effectiveLabels(i.project)))].sort();
  const toggle = (l: string) =>
    filter.labels.includes(l) ? filter.labels.filter((w) => w !== l) : [...filter.labels, l];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Projects</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every project in one list: apps that report from their Dockerfile, and the databases and services
          Observator reads from Coolify. The ones that need work come first.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox initial={filter.q} placeholder="Filter by name" label="Filter projects" />
          <nav className="flex flex-wrap gap-1" aria-label="Kind">
            {KIND_FILTERS.map((k) => (
              <Link
                key={k}
                href={projectsHref({ ...filter, kind: k })}
                scroll={false}
                className={buttonVariants({ size: "sm", variant: k === filter.kind ? "secondary" : "ghost" })}
                aria-current={k === filter.kind ? "page" : undefined}
              >
                {KIND_LABEL[k]}
                <span className="text-muted-foreground tabular-nums">{counts[k]}</span>
              </Link>
            ))}
          </nav>
        </div>
        <nav className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" aria-label="Status">
          <span className="text-muted-foreground">Status</span>
          {[null, ...STATUS_FILTERS].map((s: ProjectStatus | null) => {
            const on = filter.status === s;
            return (
              <Link
                key={s ?? "any"}
                href={projectsHref({ ...filter, status: s })}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "rounded-sm underline-offset-[5px] outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring",
                  on ? "text-foreground underline decoration-primary decoration-2" : "text-muted-foreground",
                )}
              >
                {s ? STATUS_LABEL[s] : "Any"}
              </Link>
            );
          })}
        </nav>
        {allLabels.length > 0 && (
          <nav className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" aria-label="Filter by label">
            <span className="text-muted-foreground">Labels</span>
            {allLabels.map((l) => {
              const on = filter.labels.includes(l);
              return (
                <Link
                  key={l}
                  href={projectsHref({ ...filter, labels: toggle(l) })}
                  scroll={false}
                  aria-pressed={on}
                  className={cn(
                    "rounded-sm underline-offset-[5px] outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring",
                    on
                      ? "text-foreground underline decoration-primary decoration-2"
                      : "text-muted-foreground",
                  )}
                >
                  {l}
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">No projects yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create one under{" "}
            <Link href="/settings/projects" className="underline underline-offset-4 hover:text-foreground">
              Settings → Projects
            </Link>
            , or connect Coolify for its databases and services.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">No project matches these filters</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {items.length} in{" "}
            <Link href="/projects" className="underline underline-offset-4 hover:text-foreground">
              all projects
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Runtime</TableHead>
                <TableHead>Advisories</TableHead>
                <TableHead className="text-right">Last</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ project, latest, summary, lastBuildAt }) => {
                const runtime = primaryRuntime(latest?.runtimes);
                const advisories = advisoryText(summary.vulnBySeverity);
                const kind = kindOf(project);
                return (
                  <TableRow key={project.id} className="relative">
                    <TableCell>
                      {/* The link covers the row, so the whole row opens the project. */}
                      <Link
                        href={`/projects/${project.slug}`}
                        className="font-medium after:absolute after:inset-0"
                      >
                        {project.name}
                      </Link>
                      {project.coolifyGoneAt && (
                        <span className="ml-2 text-xs text-warn">gone from Coolify</span>
                      )}
                      <LabelChips labels={effectiveLabels(project)} max={3} className="mt-1" />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{kind}</TableCell>
                    <TableCell>
                      <StatusBadge status={summary.status} />
                    </TableCell>
                    <TableCell className="font-mono text-[13px] whitespace-nowrap">
                      {runtime ? `${runtimeLabel(runtime.name)} ${runtime.version}` : "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-sm whitespace-nowrap",
                        advisories && SEVERITY_TEXT[advisories.worst],
                      )}
                    >
                      {advisories?.text ?? <span className="text-muted-foreground">none</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm whitespace-nowrap text-muted-foreground">
                      {lastBuildAt
                        ? `${kind === "app" ? "built" : "changed"} ${timeAgo(lastBuildAt)}`
                        : "never"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
