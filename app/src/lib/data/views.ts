// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { adminPb, pbDate } from "@/lib/pb/admin";
import type { BuildRecord, ComponentRecord, IgnoreRecord, IssueRecord, ProjectRecord } from "@/lib/pb/types";
import { getSettings } from "@/lib/settings";
import { summarize, type StatusSummary } from "@/lib/status";
import { getProjectBySlug } from "./projects";

export interface ProjectSummary {
  project: ProjectRecord;
  latest: BuildRecord | null;
  summary: StatusSummary;
  lastBuildAt: Date | null;
}

async function latestBuilds(projectIds: string[]): Promise<Map<string, BuildRecord>> {
  const pb = await adminPb();
  const entries = await Promise.all(
    projectIds.map(async (id) => {
      const res = await pb.collection("builds").getList<BuildRecord>(1, 1, {
        filter: pb.filter("project = {:id}", { id }),
        sort: "-created",
        fields:
          "id,project,runtimes,appName,appVersion,platform,arch,os,lockfileType,packageCount,created,error",
      });
      return [id, res.items[0]] as const;
    }),
  );
  return new Map(entries.filter((e): e is readonly [string, BuildRecord] => Boolean(e[1])));
}

export async function activeIssues(projectId?: string): Promise<IssueRecord[]> {
  const pb = await adminPb();
  const filter = projectId
    ? pb.filter("project = {:id} && status != 'resolved'", { id: projectId })
    : "status != 'resolved'";
  return pb.collection("issues").getFullList<IssueRecord>({ filter, sort: "-severity,key" });
}

export async function getOverview(): Promise<ProjectSummary[]> {
  const pb = await adminPb();
  const projects = await pb.collection("projects").getFullList<ProjectRecord>({ sort: "name" });
  const [builds, issues, settings] = await Promise.all([
    latestBuilds(projects.map((p) => p.id)),
    activeIssues(),
    getSettings(),
  ]);
  const byProject = new Map<string, IssueRecord[]>();
  for (const issue of issues) byProject.set(issue.project, [...(byProject.get(issue.project) ?? []), issue]);

  return projects.map((project) => {
    const latest = builds.get(project.id) ?? null;
    return {
      project,
      latest,
      summary: summarize(Boolean(latest), byProject.get(project.id) ?? [], settings.countDevDependencies),
      lastBuildAt: pbDate(project.lastBuildAt),
    };
  });
}

export interface ProjectView extends ProjectSummary {
  builds: BuildRecord[];
  components: ComponentRecord[];
  issues: IssueRecord[];
  resolved: IssueRecord[];
  /** Ignores that apply to this project: its own plus the global ones. */
  ignores: IgnoreRecord[];
  /** Whether advisories in dev dependencies count (the setting). */
  countDev: boolean;
}

export async function getProjectView(slug: string): Promise<ProjectView | null> {
  const project = await getProjectBySlug(slug);
  if (!project) return null;
  const pb = await adminPb();
  const byProject = pb.filter("project = {:id}", { id: project.id });

  const [builds, components, issues, resolved, ignores, settings] = await Promise.all([
    pb.collection("builds").getList<BuildRecord>(1, 100, { filter: byProject, sort: "-created" }),
    pb.collection("components").getFullList<ComponentRecord>({ filter: byProject, sort: "name,version" }),
    activeIssues(project.id),
    pb.collection("issues").getList<IssueRecord>(1, 50, {
      filter: pb.filter("project = {:id} && status = 'resolved'", { id: project.id }),
      sort: "-resolvedAt",
    }),
    pb.collection("ignores").getFullList<IgnoreRecord>({
      filter: pb.filter("project = {:id} || project = ''", { id: project.id }),
      sort: "-created",
    }),
    getSettings(),
  ]);
  const latest = builds.items[0] ?? null;
  return {
    project,
    latest,
    lastBuildAt: pbDate(project.lastBuildAt),
    summary: summarize(Boolean(latest), issues, settings.countDevDependencies),
    countDev: settings.countDevDependencies,
    builds: builds.items,
    components,
    issues,
    resolved: resolved.items,
    ignores,
  };
}
