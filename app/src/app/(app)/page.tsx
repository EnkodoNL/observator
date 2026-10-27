// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { AttentionList } from "@/components/attention-list";
import { ProjectGroupRow, ProjectRow } from "@/components/project-row";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { getOverview, type ProjectSummary } from "@/lib/data/views";
import { effectiveLabels, groupServers, hasLabels, labelKeys, sectionsByLabel } from "@/lib/labels";
import { loadEvaluators } from "@/lib/runtimes";
import { lineDescription, primaryRuntime } from "@/lib/runtimes/labels";
import { getSettings } from "@/lib/settings";
import { isStale, worstStatus } from "@/lib/status";
import { triage } from "@/lib/triage";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const WORDS = ["Nothing", "One thing", "Two things", "Three things", "Four things", "Five things"];
/** The page's one sentence: how many causes need doing. */
const headline = (n: number) =>
  n === 0 ? "Nothing needs you." : `${WORDS[n] ?? `${n} things`} ${n === 1 ? "needs" : "need"} you.`;

/** A filter or grouping choice: plain text, the active one underlined. */
const choice = (active: boolean) =>
  cn(
    "rounded-sm text-sm underline-offset-[5px] outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring",
    active ? "text-foreground underline decoration-primary decoration-2" : "text-muted-foreground",
  );

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
  const [all, settings, evaluators] = await Promise.all([getOverview(), getSettings(), loadEvaluators()]);
  /** The release line of a card's lead runtime, when it is checked. */
  const lineFor = (i: ProjectSummary) => {
    const lead = primaryRuntime(i.latest?.runtimes);
    const evaluate = lead ? evaluators.get(lead.name) : undefined;
    return lead && evaluate ? lineDescription(evaluate(lead.version)) : null;
  };

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
  const causes = triage(items, settings.staleDays);
  const runtimeFixes = causes.filter((c) => c.kind === "runtime_security").length;
  const packages = causes.filter((c) => c.kind === "package").length;
  const stale = items.filter((i) => isStale(i.summary, i.lastBuildAt, settings.staleDays));

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-4xl leading-none tracking-tight sm:text-5xl">
            {all.length === 0 ? "Nothing to watch yet." : headline(causes.length)}
          </h1>
          {all.length > 0 && (
            <p className="font-mono text-xs text-muted-foreground tabular-nums">
              {[
                plural(items.length, "project"),
                `${built.length} reporting`,
                `${runtimeFixes} runtime ${runtimeFixes === 1 ? "fix" : "fixes"}`,
                plural(packages, "package") + " to update",
                `${stale.length} stale`,
              ].join(" · ")}
            </p>
          )}
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href="/settings/projects" />}>
          <PlusIcon /> New project
        </Button>
      </div>

      {all.length === 0 ? (
        <div className="border-y py-12 text-center">
          <p className="font-medium">Add your first project</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Create a project, paste the snippet into its Dockerfile, and the next build reports its runtime
            version and packages here.
          </p>
          <Button className="mt-4" nativeButton={false} render={<Link href="/settings/projects" />}>
            <PlusIcon /> Create a project
          </Button>
        </div>
      ) : (
        <>
          <section className="space-y-3" aria-labelledby="attention">
            <h2
              id="attention"
              className="text-xs font-medium tracking-widest text-muted-foreground uppercase"
            >
              Needs attention
            </h2>
            <AttentionList causes={causes} staleDays={settings.staleDays} />
          </section>

          <section className="space-y-4" aria-labelledby="projects">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2
                id="projects"
                className="text-xs font-medium tracking-widest text-muted-foreground uppercase"
              >
                Projects
              </h2>
              {(keys.length > 0 || hasServerGroups) && (
                <nav className="flex flex-wrap items-baseline gap-x-3 gap-y-1" aria-label="Group by">
                  <span className="text-xs text-muted-foreground">Group by</span>
                  {[
                    { id: "auto", label: "servers" },
                    { id: "none", label: "nothing" },
                    ...keys.map((k) => ({ id: k, label: k })),
                  ].map((g) => (
                    <Link
                      key={g.id}
                      href={dashboardHref(g.id, wanted)}
                      scroll={false}
                      aria-current={g.id === group ? "page" : undefined}
                      className={choice(g.id === group)}
                    >
                      {g.label}
                    </Link>
                  ))}
                </nav>
              )}
            </div>
            {allLabels.length > 0 && (
              <nav className="flex flex-wrap items-center gap-1" aria-label="Filter by label">
                {allLabels.map((l) => {
                  const on = wanted.includes(l);
                  return (
                    <Link
                      key={l}
                      href={dashboardHref(group, on ? wanted.filter((w) => w !== l) : [...wanted, l])}
                      scroll={false}
                      aria-pressed={on}
                      className={cn(
                        "rounded-sm border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring",
                        on && "border-primary text-foreground",
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
                    className={cn(choice(false), "ml-1 text-xs")}
                  >
                    Clear
                  </Link>
                )}
              </nav>
            )}

            {items.length === 0 && (
              <p className="text-sm text-muted-foreground">No project has all of {wanted.join(", ")}.</p>
            )}

            {sections.map((section) => (
              <div key={String(section.value)} className="space-y-1">
                {section.value !== undefined && (
                  <div className="flex items-center gap-3 pt-4">
                    <h3 className="font-mono text-sm font-medium">
                      {section.value === null ? `no ${group}` : `${group}:${section.value}`}
                    </h3>
                    <StatusBadge status={worstStatus(section.items.map((i) => i.summary.status))} />
                    <span className="text-xs text-muted-foreground">
                      {plural(section.items.length, "project")}
                    </span>
                  </div>
                )}
                <ul className="divide-y border-y">
                  {(group === "none"
                    ? section.items.map((item) => ({ kind: "single" as const, item }))
                    : groupServers(section.items, serverOf)
                  ).map((entry) =>
                    entry.kind === "group" ? (
                      <ProjectGroupRow
                        key={entry.key}
                        name={entry.name}
                        items={entry.items}
                        staleDays={settings.staleDays}
                      />
                    ) : (
                      <ProjectRow
                        key={entry.item.project.id}
                        item={entry.item}
                        staleDays={settings.staleDays}
                        line={lineFor(entry.item)}
                      />
                    ),
                  )}
                </ul>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
