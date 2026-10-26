// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { ProjectCard } from "@/components/project-card";
import { ProjectGroupCard } from "@/components/project-group-card";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status";
import { Button, buttonVariants } from "@/components/ui/button";
import { getOverview, type ProjectSummary } from "@/lib/data/views";
import { effectiveLabels, groupServers, hasLabels, labelKeys, sectionsByLabel } from "@/lib/labels";
import { evaluateNode } from "@/lib/node/evaluate";
import { getNodeData } from "@/lib/node/releases";
import { lineDescription } from "@/lib/node/describe";
import { getSettings } from "@/lib/settings";
import { isStale, worstStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const labelsOf = (i: ProjectSummary) => effectiveLabels(i.project);
/** The servers of one app: a shared key's projects with the same reported name, one per IP. */
const serverOf = (i: ProjectSummary) =>
  i.project.ingestKey && i.project.instance
    ? { key: `${i.project.ingestKey}/${i.project.sourceName}`, name: i.project.sourceName }
    : null;

/** Dashboard URL with the filter and grouping; "auto" and no labels are the default. */
function dashboardHref(group: string, labels: string[]): string {
  const params = new URLSearchParams();
  if (group !== "auto") params.set("group", group);
  for (const l of labels) params.append("label", l);
  const search = params.toString();
  return search ? `/?${search}` : "/";
}

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const [all, settings, nodeData] = await Promise.all([getOverview(), getSettings(), getNodeData()]);

  const wanted = [params.label ?? []].flat().map(String);
  const keys = labelKeys(all.map(labelsOf));
  const group =
    typeof params.group === "string" && (params.group === "none" || keys.includes(params.group))
      ? params.group
      : "auto";
  const allLabels = [...new Set(all.flatMap(labelsOf))].sort();
  const hasServerGroups = groupServers(all, serverOf).some((e) => e.kind === "group");
  const items = all.filter((i) => hasLabels(labelsOf(i), wanted));
  const sections =
    group === "auto" || group === "none"
      ? [{ value: undefined as string | null | undefined, items }]
      : sectionsByLabel(items, group, labelsOf);
  const built = items.filter((i) => i.latest);
  const nodeFix = built.filter((i) => i.summary.nodeSecurity);
  const vulnerable = built.filter((i) => i.summary.vulnCount > 0);
  const stale = items.filter((i) => isStale(i.summary, i.lastBuildAt, settings.staleDays));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {all.length === 0
              ? "Nothing to watch yet."
              : nodeFix.length > 0
                ? `${nodeFix.length} of ${plural(built.length, "project")} ${nodeFix.length === 1 ? "runs" : "run"} a Node version with an open security fix.`
                : vulnerable.length > 0
                  ? `Node is up to date everywhere; ${plural(vulnerable.length, "project")} has vulnerable packages.`
                  : "Nothing needs your attention."}
          </p>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href="/settings/projects" />}>
          <PlusIcon /> New project
        </Button>
      </div>

      {all.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatTile
            label="Node security fixes"
            value={nodeFix.length}
            tone={nodeFix.length > 0 ? "warn" : "neutral"}
            detail={
              nodeFix.length > 0
                ? "Projects on a Node version with a newer security release"
                : "Every project is on a patched Node"
            }
          />
          <StatTile
            label="Vulnerable packages"
            value={vulnerable.length}
            tone={vulnerable.length > 0 ? "danger" : "neutral"}
            detail={vulnerable.length > 0 ? "Projects with open package advisories" : "No open advisories"}
          />
          <StatTile label="Stale" value={stale.length} detail={`No build for ${settings.staleDays}+ days`} />
        </div>
      )}

      {all.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <p className="font-medium">Add your first project</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Create a project, paste the snippet into its Dockerfile, and the next build reports its Node
            version and packages here.
          </p>
          <Button className="mt-4" nativeButton={false} render={<Link href="/settings/projects" />}>
            <PlusIcon /> Create a project
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {(allLabels.length > 0 || hasServerGroups) && (
            <div className="space-y-2">
              <nav className="flex flex-wrap items-center gap-1" aria-label="Group by">
                <span className="mr-1 text-sm text-muted-foreground">Group by</span>
                {[
                  { id: "auto", label: "Servers" },
                  { id: "none", label: "Nothing" },
                  ...keys.map((k) => ({ id: k, label: k })),
                ].map((g) => (
                  <Link
                    key={g.id}
                    href={dashboardHref(g.id, wanted)}
                    scroll={false}
                    aria-current={g.id === group ? "page" : undefined}
                    className={buttonVariants({
                      size: "sm",
                      variant: g.id === group ? "secondary" : "ghost",
                    })}
                  >
                    {g.label}
                  </Link>
                ))}
              </nav>
              {allLabels.length > 0 && (
                <nav className="flex flex-wrap items-center gap-1" aria-label="Filter by label">
                  <span className="mr-1 text-sm text-muted-foreground">Labels</span>
                  {allLabels.map((l) => {
                    const on = wanted.includes(l);
                    return (
                      <Link
                        key={l}
                        href={dashboardHref(group, on ? wanted.filter((w) => w !== l) : [...wanted, l])}
                        scroll={false}
                        aria-pressed={on}
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 font-mono text-xs transition-colors hover:bg-muted",
                          on && "border-foreground/40 bg-muted",
                        )}
                      >
                        {l}
                      </Link>
                    );
                  })}
                  {wanted.length > 0 && (
                    <Link
                      href={dashboardHref(group, [])}
                      scroll={false}
                      className="ml-1 text-xs underline-offset-4 hover:underline"
                    >
                      Clear
                    </Link>
                  )}
                </nav>
              )}
            </div>
          )}

          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">No project has all of {wanted.join(", ")}.</p>
          )}

          {sections.map((section) => (
            <section key={String(section.value)} className="space-y-3">
              {section.value !== undefined && (
                <div className="flex items-center gap-2">
                  <h2 className="font-mono text-sm font-medium">
                    {section.value === null ? `no ${group}` : `${group}:${section.value}`}
                  </h2>
                  <StatusBadge status={worstStatus(section.items.map((i) => i.summary.status))} />
                  <span className="text-xs text-muted-foreground">
                    {plural(section.items.length, "project")}
                  </span>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(group === "none"
                  ? section.items.map((item) => ({ kind: "single" as const, item }))
                  : groupServers(section.items, serverOf)
                ).map((entry) =>
                  entry.kind === "group" ? (
                    <ProjectGroupCard
                      key={entry.key}
                      name={entry.name}
                      items={entry.items}
                      staleDays={settings.staleDays}
                    />
                  ) : (
                    <ProjectCard
                      key={entry.item.project.id}
                      item={entry.item}
                      staleDays={settings.staleDays}
                      line={
                        entry.item.latest && nodeData
                          ? lineDescription(evaluateNode(entry.item.latest.nodeVersion, nodeData))
                          : null
                      }
                    />
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
