// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import semver from "semver";
import { vulnVersions, type VulnIssueData } from "@/lib/issues/types";
import { adminPb } from "@/lib/pb/admin";
import type { ComponentRecord, IssueRecord, ProjectRecord, Severity } from "@/lib/pb/types";
import { severityRank } from "@/lib/severity";

export interface PackageUsage {
  project: { id: string; name: string; slug: string };
  version: string;
  direct: boolean;
  dev: boolean;
  via: string[];
  severity: Severity | null;
  advisories: number;
}

export interface PackageResult {
  name: string;
  versions: string[];
  usages: PackageUsage[];
}

const LIMIT = 2000;

/** "Where is lodash used, and in which version?" across all projects. */
export async function searchPackages(
  query: string,
): Promise<{ results: PackageResult[]; truncated: boolean }> {
  const q = query.trim().toLowerCase();
  if (!q) return { results: [], truncated: false };
  const pb = await adminPb();
  const [rows, projects, issues] = await Promise.all([
    pb.collection("components").getList<ComponentRecord>(1, LIMIT, {
      filter: pb.filter("name ~ {:q}", { q }),
      sort: "name,version",
    }),
    pb.collection("projects").getFullList<ProjectRecord>({ fields: "id,name,slug" }),
    pb.collection("issues").getFullList<IssueRecord>({ filter: "kind = 'vuln' && status = 'open'" }),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const advisories = new Map<string, { severity: Severity; count: number }>();
  for (const issue of issues) {
    const d = issue.data as unknown as VulnIssueData;
    for (const version of vulnVersions(d)) {
      const key = `${issue.project}/${d.package}@${version}`;
      const prev = advisories.get(key);
      advisories.set(key, {
        severity:
          !prev || severityRank(issue.severity) > severityRank(prev.severity)
            ? issue.severity
            : prev.severity,
        count: (prev?.count ?? 0) + 1,
      });
    }
  }

  const byName = new Map<string, PackageResult>();
  for (const c of rows.items) {
    const project = projectById.get(c.project);
    if (!project) continue;
    const result = byName.get(c.name) ?? { name: c.name, versions: [], usages: [] };
    if (!result.versions.includes(c.version)) result.versions.push(c.version);
    const a = advisories.get(`${c.project}/${c.name}@${c.version}`);
    result.usages.push({
      project: { id: project.id, name: project.name, slug: project.slug },
      version: c.version,
      direct: c.direct,
      dev: c.dev,
      via: c.via ?? [],
      severity: a?.severity ?? null,
      advisories: a?.count ?? 0,
    });
    byName.set(c.name, result);
  }

  const sortVersions = (a: string, b: string) =>
    semver.valid(a) && semver.valid(b) ? semver.rcompare(a, b) : b.localeCompare(a);
  const results = [...byName.values()].map((r) => ({
    ...r,
    versions: r.versions.sort(sortVersions),
    usages: r.usages.sort(
      (a, b) => a.project.name.localeCompare(b.project.name) || sortVersions(a.version, b.version),
    ),
  }));
  // Exact match first, then prefix matches, then the rest by how widely the package is used.
  const rank = (name: string) => (name === q ? 0 : name.startsWith(q) || name.startsWith(`@${q}`) ? 1 : 2);
  results.sort(
    (a, b) =>
      rank(a.name) - rank(b.name) || b.usages.length - a.usages.length || a.name.localeCompare(b.name),
  );
  return { results: results.slice(0, 50), truncated: rows.totalItems > LIMIT || results.length > 50 };
}

/** Direct dependencies used by the most projects, as a starting point on the empty search page. */
export async function popularPackages(limit = 24): Promise<{ name: string; projects: number }[]> {
  const pb = await adminPb();
  const rows = await pb.collection("components").getFullList<ComponentRecord>({
    filter: "direct = true",
    fields: "name,project",
  });
  const counts = new Map<string, Set<string>>();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? new Set()).add(r.project));
  return [...counts]
    .map(([name, set]) => ({ name, projects: set.size }))
    .sort((a, b) => b.projects - a.projects || a.name.localeCompare(b.name))
    .slice(0, limit);
}
