// SPDX-License-Identifier: FSL-1.1-ALv2
import { effectiveLabels, hasLabels } from "@/lib/labels";
import type { ProjectRecord } from "@/lib/pb/types";
import type { ProjectStatus } from "@/lib/status";
import type { ProjectSummary } from "./views";

/*
 * The /projects table: every project, filtered by kind (an app with the snippet, or a Coolify
 * database or service), status, labels and a search, with the ones that need work first.
 */

export type ProjectKind = "app" | "database" | "service";
export const KIND_FILTERS = ["all", "apps", "databases", "services"] as const;
export type KindFilter = (typeof KIND_FILTERS)[number];
export const STATUS_FILTERS = [
  "vulnerable",
  "update",
  "unchecked",
  "none",
  "ok",
] as const satisfies ProjectStatus[];

export const kindOf = (p: Pick<ProjectRecord, "coolifyKind">): ProjectKind => p.coolifyKind || "app";

const KIND_OF_FILTER: Record<Exclude<KindFilter, "all">, ProjectKind> = {
  apps: "app",
  databases: "database",
  services: "service",
};

/** Needs work first: the order of STATUS_FILTERS. */
const rank = (status: ProjectStatus) => STATUS_FILTERS.indexOf(status);

export interface ProjectListFilter {
  kind: KindFilter;
  status: ProjectStatus | null;
  q: string;
  labels: string[];
}

/** The rows for a filter, and per kind how many there would be with the other filters as they are. */
export function projectList(
  items: readonly ProjectSummary[],
  filter: ProjectListFilter,
): { rows: ProjectSummary[]; counts: Record<KindFilter, number> } {
  const q = filter.q.trim().toLowerCase();
  const others = items.filter(
    (i) =>
      (!filter.status || i.summary.status === filter.status) &&
      (!q || i.project.name.toLowerCase().includes(q) || i.project.slug.includes(q)) &&
      hasLabels(effectiveLabels(i.project), filter.labels),
  );
  const counts = {
    all: others.length,
    apps: others.filter((i) => kindOf(i.project) === "app").length,
    databases: others.filter((i) => kindOf(i.project) === "database").length,
    services: others.filter((i) => kindOf(i.project) === "service").length,
  };
  const rows = others
    .filter((i) => filter.kind === "all" || kindOf(i.project) === KIND_OF_FILTER[filter.kind])
    .sort(
      (a, b) =>
        rank(a.summary.status) - rank(b.summary.status) || a.project.name.localeCompare(b.project.name),
    );
  return { rows, counts };
}
