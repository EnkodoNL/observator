// SPDX-License-Identifier: FSL-1.1-ALv2
import semver from "semver";
import { vulnVersions, type VulnIssueData } from "@/lib/issues/types";
import type { IssueRecord, Severity } from "@/lib/pb/types";
import { maxSeverity, severityRank } from "@/lib/severity";

/** One package's advisories in a project, with the one upgrade that fixes all open ones. */
export interface VulnGroup {
  key: string;
  package: string;
  versions: string[];
  /** The worst open advisory; ignored ones only count when nothing is open. */
  severity: Severity;
  issues: IssueRecord[];
  open: number;
  /** An open advisory whose fixed version covers every other open one, for the advice. */
  fix: VulnIssueData | null;
  /** Open advisories without a fixed version: the upgrade does not close those. */
  unfixed: number;
}

const data = (i: IssueRecord) => i.data as unknown as VulnIssueData;
const newer = (a: string, b: string) => {
  const [x, y] = [semver.coerce(a), semver.coerce(b)];
  return x && y ? semver.gt(x, y) : a > b;
};

export function groupVulns(issues: IssueRecord[]): VulnGroup[] {
  const groups = new Map<string, IssueRecord[]>();
  for (const issue of issues) {
    const d = data(issue);
    const key = `${d.ecosystem ?? "npm"}:${d.package}`;
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  }
  return [...groups]
    .map(([key, list]): VulnGroup => {
      const open = list.filter((i) => i.status !== "ignored");
      const fixable = open.filter((i) => data(i).fixedIn);
      const fix = fixable.reduce<IssueRecord | null>(
        (best, i) => (!best || newer(data(i).fixedIn, data(best).fixedIn) ? i : best),
        null,
      );
      const sorted = [...list].sort(
        (a, b) =>
          Number(a.status === "ignored") - Number(b.status === "ignored") ||
          severityRank(b.severity) - severityRank(a.severity),
      );
      return {
        key,
        package: data(list[0]).package,
        versions: [...new Set(list.flatMap((i) => vulnVersions(data(i))))].sort(),
        severity: maxSeverity((open.length ? open : list).map((i) => i.severity)) ?? "unknown",
        issues: sorted,
        open: open.length,
        fix: fix ? data(fix) : null,
        unfixed: open.length - fixable.length,
      };
    })
    .sort(
      (a, b) =>
        Number(a.open === 0) - Number(b.open === 0) ||
        severityRank(b.severity) - severityRank(a.severity) ||
        b.open - a.open ||
        a.package.localeCompare(b.package),
    );
}
