// SPDX-License-Identifier: FSL-1.1-ALv2
import Link from "next/link";
import { ServerIcon } from "lucide-react";
import { LabelChips } from "@/components/label-chips";
import { StatusBadge } from "@/components/status";
import type { ProjectSummary } from "@/lib/data/views";
import { effectiveLabels } from "@/lib/labels";
import { isStale, worstStatus } from "@/lib/status";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * The servers of one app (a shared key's projects per source IP) as one card: the worst
 * status on top, a row per server below, each leading to its own project.
 */
export function ProjectGroupCard({
  name,
  items,
  staleDays,
}: {
  name: string;
  items: ProjectSummary[];
  staleDays: number;
}) {
  const status = worstStatus(items.map((i) => i.summary.status));
  const allStale = items.every((i) => isStale(i.summary, i.lastBuildAt, staleDays));
  // Labels every server has; the rest differs per server and shows on its own page.
  const shared = items
    .map((i) => effectiveLabels(i.project))
    .reduce((acc, l) => acc.filter((x) => l.includes(x)));
  const versions = [...new Set(items.map((i) => i.latest?.nodeVersion).filter(Boolean))];
  const lastBuild = items.reduce<Date | null>(
    (a, i) => (i.lastBuildAt && (!a || i.lastBuildAt > a) ? i.lastBuildAt : a),
    null,
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 transition-opacity",
        allStale && "opacity-70 hover:opacity-100",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{name}</h3>
          <p className="text-xs text-muted-foreground">
            {items.length} servers ·{" "}
            {versions.length === 1 ? `Node ${versions[0]}` : `${versions.length} Node versions`}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>
      <LabelChips labels={shared} max={4} />
      <ul className="-mx-2 divide-y border-t">
        {items.map((i) => (
          <li key={i.project.id}>
            <Link
              href={`/projects/${i.project.slug}`}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ServerIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                {i.project.instance || i.project.name}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {i.latest?.nodeVersion ?? "no build"}
              </span>
              <StatusBadge status={i.summary.status} className="h-5 px-2 text-[11px]" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-auto text-xs text-muted-foreground">
        {lastBuild ? `Last build ${timeAgo(lastBuild)}` : "Never built"}
      </p>
    </div>
  );
}
