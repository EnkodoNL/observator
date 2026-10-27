// SPDX-License-Identifier: FSL-1.1-ALv2
import Link from "next/link";
import { LabelChips } from "@/components/label-chips";
import { StatusBadge } from "@/components/status";
import type { ProjectSummary } from "@/lib/data/views";
import { effectiveLabels } from "@/lib/labels";
import type { Severity } from "@/lib/pb/types";
import { primaryRuntime } from "@/lib/runtimes/labels";
import { isStale, worstStatus } from "@/lib/status";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

const ORDER: Severity[] = ["critical", "high", "moderate", "low", "unknown"];

/** Name | runtime | release line | advisories | last build; two lines on a phone. */
const GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.5fr)_minmax(0,1fr)_7rem] md:items-baseline";

/** The two heaviest severities, the heaviest in its colour: "1 critical · 8 high". */
function Advisories({ counts }: { counts: Partial<Record<Severity, number>> }) {
  const present = ORDER.filter((s) => counts[s]).slice(0, 2);
  if (present.length === 0) return <span className="text-muted-foreground">No advisories</span>;
  return (
    <span className="font-mono">
      {present.map((s, i) => (
        <span
          key={s}
          className={cn(
            i === 0 && (s === "critical" || s === "high")
              ? "text-danger"
              : i === 0 && s === "moderate"
                ? "text-warn"
                : "text-muted-foreground",
          )}
        >
          {i > 0 && <span className="text-muted-foreground"> · </span>}
          {counts[s]} {s}
        </span>
      ))}
    </span>
  );
}

function Runtime({ item }: { item: ProjectSummary }) {
  if (!item.latest) return <span className="text-muted-foreground">waiting for a build</span>;
  const lead = primaryRuntime(item.latest.runtimes);
  if (!lead) return <span className="text-muted-foreground">no runtime</span>;
  const fix = item.summary.runtimeSecurity.length > 0;
  return (
    <span className="font-mono">
      <span className="text-muted-foreground">{lead.name} </span>
      <span className={cn(fix && "text-warn")}>{lead.version}</span>
    </span>
  );
}

function LastBuild({ item, staleDays }: { item: ProjectSummary; staleDays: number }) {
  const stale = isStale(item.summary, item.lastBuildAt, staleDays);
  return (
    <span className={cn("text-muted-foreground md:text-right", stale && "text-warn")}>
      {item.lastBuildAt ? timeAgo(item.lastBuildAt) : "never"}
      {stale && " · stale"}
    </span>
  );
}

const rowLink =
  "rounded-sm outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring";

export function ProjectRow({
  item,
  staleDays,
  line,
}: {
  item: ProjectSummary;
  staleDays: number;
  line?: string | null;
}) {
  const labels = effectiveLabels(item.project);
  return (
    <li>
      <Link href={`/projects/${item.project.slug}`} className={cn(GRID, rowLink, "-mx-2 px-2 py-3 text-sm")}>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <StatusDot item={item} />
            <span className="truncate font-medium">{item.project.name}</span>
          </span>
          {labels.length > 0 && <LabelChips labels={labels} max={3} className="mt-1 ml-4" />}
        </span>
        <span className="text-right md:text-left">
          <Runtime item={item} />
        </span>
        <span className="hidden truncate text-xs text-muted-foreground md:block">{line}</span>
        <span className="ml-4 text-xs md:ml-0">
          {item.latest && <Advisories counts={item.summary.vulnBySeverity} />}
        </span>
        <span className="text-right text-xs">
          <LastBuild item={item} staleDays={staleDays} />
        </span>
      </Link>
    </li>
  );
}

const StatusDot = ({ item }: { item: ProjectSummary }) => <StatusBadge status={item.summary.status} dot />;

/** The servers of one app (a shared key's projects per source IP): one row, a line per server. */
export function ProjectGroupRow({
  name,
  items,
  staleDays,
}: {
  name: string;
  items: ProjectSummary[];
  staleDays: number;
}) {
  const status = worstStatus(items.map((i) => i.summary.status));
  const shared = items
    .map((i) => effectiveLabels(i.project))
    .reduce((acc, l) => acc.filter((x) => l.includes(x)));
  return (
    <li className="py-3">
      <div className="flex items-center gap-2 text-sm">
        <StatusBadge status={status} dot />
        <span className="font-medium">{name}</span>
        <span className="text-xs text-muted-foreground">{items.length} servers</span>
      </div>
      {shared.length > 0 && <LabelChips labels={shared} max={3} className="mt-1 ml-4" />}
      <ul className="mt-1 ml-4 border-l">
        {items.map((i) => (
          <li key={i.project.id}>
            <Link
              href={`/projects/${i.project.slug}`}
              className={cn(GRID, rowLink, "ml-0 py-2 pr-2 pl-3 text-sm")}
            >
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot item={i} />
                <span className="truncate font-mono text-[13px]">{i.project.instance || i.project.name}</span>
              </span>
              <span className="text-right md:text-left">
                <Runtime item={i} />
              </span>
              <span className="hidden md:block" />
              <span className="ml-4 text-xs md:ml-0">
                {i.latest && <Advisories counts={i.summary.vulnBySeverity} />}
              </span>
              <span className="text-right text-xs">
                <LastBuild item={i} staleDays={staleDays} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}
