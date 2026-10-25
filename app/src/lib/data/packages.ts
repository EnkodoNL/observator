// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import semver from "semver";
import { vulnVersions, type VulnIssueData } from "@/lib/issues/types";
import { latestVersions } from "@/lib/npm-latest";
import { adminPb } from "@/lib/pb/admin";
import type { ComponentRecord, IssueRecord, ProjectRecord, Severity } from "@/lib/pb/types";
import { severityRank } from "@/lib/severity";

export type PackageScope = "direct" | "all" | "vulnerable";
export const PACKAGE_SCOPES: PackageScope[] = ["direct", "all", "vulnerable"];

/** One package across all projects. */
export interface PackageSummary {
  name: string;
  versions: string[];
  projects: number;
  /** A direct dependency of at least one project. */
  direct: boolean;
  severity: Severity | null;
  advisories: number;
}

export interface PackageUsage {
  project: { id: string; name: string; slug: string };
  version: string;
  direct: boolean;
  dev: boolean;
  via: string[];
  severity: Severity | null;
  advisories: number;
}

export interface PackageAdvisory {
  osvId: string;
  severity: Severity;
  summary: string;
  url: string;
  fixedIn: string;
  versions: string[];
  projects: { name: string; slug: string }[];
  ignored: boolean;
}

export interface PackageDetail {
  name: string;
  latest?: string;
  versions: string[];
  usages: PackageUsage[];
  advisories: PackageAdvisory[];
}

export const sortVersions = (a: string, b: string) =>
  semver.valid(a) && semver.valid(b) ? semver.rcompare(a, b) : b.localeCompare(a);

const worse = (a: Severity | null, b: Severity): Severity =>
  !a || severityRank(b) > severityRank(a) ? b : a;

/** Open advisories per package name, and per project/name@version for single rows. */
function indexAdvisories(issues: IssueRecord[]) {
  const byName = new Map<string, { severity: Severity; ids: Set<string> }>();
  const byRow = new Map<string, { severity: Severity; count: number }>();
  for (const issue of issues) {
    const d = issue.data as unknown as VulnIssueData;
    const named = byName.get(d.package) ?? { severity: issue.severity, ids: new Set<string>() };
    named.severity = worse(named.severity, issue.severity);
    named.ids.add(d.osvId);
    byName.set(d.package, named);
    for (const version of vulnVersions(d)) {
      const key = `${issue.project}/${d.package}@${version}`;
      const prev = byRow.get(key);
      byRow.set(key, {
        severity: worse(prev?.severity ?? null, issue.severity),
        count: (prev?.count ?? 0) + 1,
      });
    }
  }
  return { byName, byRow };
}

/**
 * Every package in the projects' lockfiles, one row per name. Vulnerable packages first, then
 * the ones most projects share. Counts per scope follow the search, so the tabs stay honest.
 */
export async function listPackages(
  query: string,
  scope: PackageScope,
): Promise<{ packages: PackageSummary[]; counts: Record<PackageScope, number> }> {
  const q = query.trim().toLowerCase();
  const pb = await adminPb();
  const [rows, issues] = await Promise.all([
    pb.collection("components").getFullList<ComponentRecord>({
      fields: "name,version,project,direct",
      ...(q ? { filter: pb.filter("name ~ {:q}", { q }) } : {}),
    }),
    pb.collection("issues").getFullList<IssueRecord>({
      filter: "kind = 'vuln' && status = 'open'",
      fields: "project,severity,data",
    }),
  ]);
  const { byName } = indexAdvisories(issues);

  const grouped = new Map<string, { versions: Set<string>; projects: Set<string>; direct: boolean }>();
  for (const c of rows) {
    const g = grouped.get(c.name) ?? { versions: new Set(), projects: new Set(), direct: false };
    g.versions.add(c.version);
    g.projects.add(c.project);
    g.direct ||= c.direct;
    grouped.set(c.name, g);
  }

  const all: PackageSummary[] = [...grouped].map(([name, g]) => {
    const a = byName.get(name);
    return {
      name,
      versions: [...g.versions].sort(sortVersions),
      projects: g.projects.size,
      direct: g.direct,
      severity: a?.severity ?? null,
      advisories: a?.ids.size ?? 0,
    };
  });
  const inScope = (p: PackageSummary, s: PackageScope) =>
    s === "all" || (s === "direct" ? p.direct : p.advisories > 0);
  const counts = {
    direct: all.filter((p) => inScope(p, "direct")).length,
    all: all.length,
    vulnerable: all.filter((p) => inScope(p, "vulnerable")).length,
  };

  const rank = (name: string) =>
    !q ? 0 : name === q ? 0 : name.startsWith(q) || name.startsWith(`@${q}`) ? 1 : 2;
  const packages = all
    .filter((p) => inScope(p, scope))
    .sort(
      (a, b) =>
        rank(a.name) - rank(b.name) ||
        (b.severity ? severityRank(b.severity) : 0) - (a.severity ? severityRank(a.severity) : 0) ||
        b.projects - a.projects ||
        a.name.localeCompare(b.name),
    );
  return { packages, counts };
}

/** Where one package is used, in which versions, and which advisories apply. */
export async function packageDetail(name: string): Promise<PackageDetail | null> {
  const pb = await adminPb();
  const [rows, projects, issues, latest] = await Promise.all([
    pb
      .collection("components")
      .getFullList<ComponentRecord>({ filter: pb.filter("name = {:name}", { name }) }),
    pb.collection("projects").getFullList<ProjectRecord>({ fields: "id,name,slug" }),
    // The key is vuln:<osvId>:<package>; the exact package is checked below.
    pb.collection("issues").getFullList<IssueRecord>({
      filter: pb.filter("kind = 'vuln' && status != 'resolved' && key ~ {:suffix}", { suffix: `:${name}` }),
    }),
    latestVersions(),
  ]);
  if (rows.length === 0) return null;

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const relevant = issues.filter((i) => (i.data as unknown as VulnIssueData).package === name);
  const { byRow } = indexAdvisories(relevant.filter((i) => i.status === "open"));

  const usages: PackageUsage[] = [];
  for (const c of rows) {
    const project = projectById.get(c.project);
    if (!project) continue;
    const a = byRow.get(`${c.project}/${c.name}@${c.version}`);
    usages.push({
      project: { id: project.id, name: project.name, slug: project.slug },
      version: c.version,
      direct: c.direct,
      dev: c.dev,
      via: c.via ?? [],
      severity: a?.severity ?? null,
      advisories: a?.count ?? 0,
    });
  }
  usages.sort((a, b) => sortVersions(a.version, b.version) || a.project.name.localeCompare(b.project.name));

  const advisories = new Map<string, PackageAdvisory>();
  for (const issue of relevant) {
    const d = issue.data as unknown as VulnIssueData;
    const project = projectById.get(issue.project);
    const a = advisories.get(d.osvId) ?? {
      osvId: d.osvId,
      severity: issue.severity,
      summary: d.summary,
      url: d.url,
      fixedIn: d.fixedIn,
      versions: [],
      projects: [],
      ignored: true,
    };
    a.severity = worse(a.severity, issue.severity);
    a.ignored &&= issue.status === "ignored";
    for (const v of vulnVersions(d)) if (!a.versions.includes(v)) a.versions.push(v);
    if (project && !a.projects.some((p) => p.slug === project.slug))
      a.projects.push({ name: project.name, slug: project.slug });
    advisories.set(d.osvId, a);
  }

  return {
    name,
    latest: latest[name],
    versions: [...new Set(usages.map((u) => u.version))].sort(sortVersions),
    usages,
    advisories: [...advisories.values()]
      .map((a) => ({ ...a, versions: a.versions.sort(sortVersions) }))
      .sort(
        (a, b) =>
          Number(a.ignored) - Number(b.ignored) ||
          severityRank(b.severity) - severityRank(a.severity) ||
          a.osvId.localeCompare(b.osvId),
      ),
  };
}
