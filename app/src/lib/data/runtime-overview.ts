// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import semver from "semver";
import { getOverview, type ProjectSummary } from "@/lib/data/views";
import { CHECKED_RUNTIMES, runtimeLabel } from "@/lib/runtimes/labels";
import { loadEvaluators } from "@/lib/runtimes";
import type { RuntimeEvaluation } from "@/lib/runtimes/types";

export interface VersionGroup {
  version: string;
  /** Null for runtimes without release checks, or without release data right now. */
  evaluation: RuntimeEvaluation | null;
  projects: ProjectSummary[];
}

export interface RuntimeSection {
  runtime: string;
  label: string;
  checked: boolean;
  /** Newest version first. */
  versions: VersionGroup[];
  /** Projects on a version with a newer security release in its line. */
  affected: number;
  /** The versions those projects should move to. */
  targets: string[];
}

const byVersionDesc = (a: string, b: string) =>
  semver.valid(a) && semver.valid(b)
    ? semver.rcompare(a, b)
    : b.localeCompare(a, undefined, { numeric: true });

/** All projects grouped per runtime, then by the version their latest build reported. */
export async function runtimeOverview(): Promise<RuntimeSection[]> {
  const [items, evaluators] = await Promise.all([getOverview(), loadEvaluators()]);
  const sections = new Map<string, Map<string, VersionGroup>>();
  for (const item of items) {
    for (const rt of item.latest?.runtimes ?? []) {
      const versions = sections.get(rt.name) ?? new Map<string, VersionGroup>();
      const group = versions.get(rt.version) ?? {
        version: rt.version,
        evaluation: evaluators.get(rt.name)?.(rt.version) ?? null,
        projects: [],
      };
      group.projects.push(item);
      versions.set(rt.version, group);
      sections.set(rt.name, versions);
    }
  }
  return [...sections]
    .map(([runtime, versions]) => {
      const sorted = [...versions.values()].sort((a, b) => byVersionDesc(a.version, b.version));
      const behind = sorted.filter((g) => g.evaluation?.securityUpdate);
      return {
        runtime,
        label: runtimeLabel(runtime),
        checked: CHECKED_RUNTIMES.includes(runtime),
        versions: sorted,
        affected: behind.reduce((n, g) => n + g.projects.length, 0),
        targets: [...new Set(behind.map((g) => g.evaluation!.securityUpdate!.target))],
      };
    })
    .sort((a, b) => Number(b.checked) - Number(a.checked) || a.label.localeCompare(b.label));
}
