// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { ProjectCard } from "@/components/project-card";
import { StatTile } from "@/components/stat-tile";
import { Button } from "@/components/ui/button";
import { getOverview } from "@/lib/data/views";
import { evaluateNode } from "@/lib/node/evaluate";
import { getNodeData } from "@/lib/node/releases";
import { lineDescription } from "@/app/(app)/projects/[slug]/node-panel";
import { getSettings } from "@/lib/settings";
import { daysSince } from "@/lib/time";

export const metadata: Metadata = { title: "Overview" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default async function DashboardPage() {
  const [items, settings, nodeData] = await Promise.all([getOverview(), getSettings(), getNodeData()]);
  const built = items.filter((i) => i.latest);
  const nodeFix = built.filter((i) => i.summary.nodeSecurity);
  const vulnerable = built.filter((i) => i.summary.vulnCount > 0);
  const stale = items.filter((i) => {
    const age = daysSince(i.lastBuildAt);
    return i.summary.stale || (age !== null && age >= settings.staleDays);
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {items.length === 0
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

      {items.length > 0 && (
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

      {items.length === 0 ? (
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <ProjectCard
              key={item.project.id}
              item={item}
              staleDays={settings.staleDays}
              line={
                item.latest && nodeData
                  ? lineDescription(evaluateNode(item.latest.nodeVersion, nodeData))
                  : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
