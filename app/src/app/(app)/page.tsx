// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "@phosphor-icons/react/ssr";
import { AppBoard } from "@/components/app-board";
import { AttentionList } from "@/components/attention-list";
import { Button } from "@/components/ui/button";
import { appBoard } from "@/lib/app-board";
import { getOverview, type ProjectSummary } from "@/lib/data/views";
import { effectiveLabels, hasLabels } from "@/lib/labels";
import { getSettings } from "@/lib/settings";
import { triage } from "@/lib/triage";
import { cn } from "@/lib/utils";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Overview" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const WORDS = ["Nothing", "One thing", "Two things", "Three things", "Four things", "Five things"];
/** The page's one sentence: how many causes need doing. */
const headline = (n: number) =>
  n === 0 ? "Nothing needs you." : `${WORDS[n] ?? `${n} things`} ${n === 1 ? "needs" : "need"} you.`;

const labelsOf = (i: ProjectSummary) => effectiveLabels(i.project);

/** Dashboard URL with the label filter. */
function dashboardHref(labels: string[]): string {
  const params = new URLSearchParams();
  for (const l of labels) params.append("label", l);
  const search = params.toString();
  return search ? `/?${search}` : "/";
}

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  await requireUser();
  const params = await searchParams;
  const [all, settings] = await Promise.all([getOverview(), getSettings()]);

  const wanted = [params.label ?? []].flat().map(String);
  const allLabels = [...new Set(all.flatMap(labelsOf))].sort();
  const items = all.filter((i) => hasLabels(labelsOf(i), wanted));
  const apps = appBoard(items, settings.staleDays);
  const causes = triage(items, settings.staleDays);

  const vulnerable = apps.filter((a) => a.advisories > 0).length;
  const runtimeFixes = causes.filter((c) => c.kind === "runtime_security").length;
  const buildOnly = apps.reduce((n, a) => n + a.buildOnly, 0);
  const stale = causes.find((c) => c.kind === "stale")?.projects.length ?? 0;

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-[62ch] space-y-3">
          <h1 className="font-display text-4xl leading-none font-bold tracking-tight sm:text-5xl">
            {all.length === 0 ? "Nothing to watch yet." : headline(causes.length)}
          </h1>
          {all.length > 0 && (
            <p className="text-muted-foreground">
              <b className="text-foreground">
                {vulnerable === 0 ? "No app" : `${vulnerable} of ${plural(apps.length, "app")}`}
              </b>{" "}
              {vulnerable === 1 || vulnerable === 0 ? "runs" : "run"} a vulnerable package in production.{" "}
              {runtimeFixes
                ? `${plural(runtimeFixes, "runtime")} ${runtimeFixes === 1 ? "has" : "have"} a security release waiting. `
                : "Runtimes are all patched. "}
              {stale > 0 && `${plural(stale, "project")} stopped reporting. `}
              {buildOnly > 0 && (
                <>
                  <b className="text-foreground">{plural(buildOnly, "advisory", "advisories")}</b> sit in
                  build-only dependencies and are counted separately.
                </>
              )}
            </p>
          )}
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href="/settings/projects" />}>
          <PlusIcon /> New project
        </Button>
      </div>

      {all.length === 0 ? (
        <div className="border-y py-12">
          <p className="font-display text-lg font-bold">Add your first project</p>
          <p className="mt-1 max-w-md text-muted-foreground">
            Create a project, paste the snippet into its Dockerfile, and the next build reports its runtime
            version and packages here.
          </p>
          <Button className="mt-4" nativeButton={false} render={<Link href="/settings/projects" />}>
            <PlusIcon /> Create a project
          </Button>
        </div>
      ) : (
        <>
          <section className="space-y-3" aria-labelledby="todo">
            <h2 id="todo" className="font-display text-xl font-bold tracking-tight">
              To do
            </h2>
            <AttentionList causes={causes} staleDays={settings.staleDays} />
          </section>

          <div className="space-y-4">
            {allLabels.length > 0 && (
              <nav
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
                aria-label="Filter by label"
              >
                <span className="text-muted-foreground">Show only</span>
                {allLabels.map((l) => {
                  const on = wanted.includes(l);
                  return (
                    <Link
                      key={l}
                      href={dashboardHref(on ? wanted.filter((w) => w !== l) : [...wanted, l])}
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
                {wanted.length > 0 && (
                  <Link href={dashboardHref([])} scroll={false} className="font-bold text-primary">
                    Show all
                  </Link>
                )}
              </nav>
            )}
            {items.length === 0 ? (
              <p className="text-muted-foreground">No project has all of {wanted.join(", ")}.</p>
            ) : (
              <AppBoard apps={apps} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
