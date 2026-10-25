// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { adminPb, pbDate, toPbDate } from "@/lib/pb/admin";
import { evaluateNode, type NodeData } from "@/lib/node/evaluate";
import { getNodeData } from "@/lib/node/releases";
import type {
  BuildRecord,
  ComponentRecord,
  IgnoreRecord,
  IssueRecord,
  ProjectRecord,
  VulnerabilityRecord,
} from "@/lib/pb/types";
import { getSettings } from "@/lib/settings";
import { computeDesired } from "./desired";
import type { IssueEvent } from "./events";
import { reconcile, type IssueWrite } from "./reconcile";

const g = globalThis as typeof globalThis & { __issueLocks?: Map<string, Promise<unknown>> };
const locks = (g.__issueLocks ??= new Map());

/** Serializes evaluations per project within this process. */
function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(projectId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(projectId, next);
  void next.finally(() => {
    if (locks.get(projectId) === next) locks.delete(projectId);
  });
  return next;
}

function toRecord(w: Partial<IssueWrite>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...w };
  for (const k of ["firstSeen", "lastSeen", "resolvedAt"] as const) {
    if (k in w) out[k] = w[k] ? toPbDate(w[k] as Date) : "";
  }
  return out;
}

interface Shared {
  nodeData: NodeData | null;
  staleDays: number;
  ignores: IgnoreRecord[];
  vulns: VulnerabilityRecord[];
  now: Date;
}

async function loadShared(): Promise<Shared> {
  const pb = await adminPb();
  const [nodeData, settings, ignores, vulns] = await Promise.all([
    getNodeData(),
    getSettings(),
    pb.collection("ignores").getFullList<IgnoreRecord>(),
    pb.collection("vulnerabilities").getFullList<VulnerabilityRecord>({ filter: "ecosystem = 'npm'" }),
  ]);
  return { nodeData, staleDays: settings.staleDays, ignores, vulns, now: new Date() };
}

async function evaluateOne(project: ProjectRecord, shared: Shared): Promise<IssueEvent[]> {
  const pb = await adminPb();
  const byProject = pb.filter("project = {:id}", { id: project.id });
  const [builds, components, existing] = await Promise.all([
    pb.collection("builds").getList<BuildRecord>(1, 1, { filter: byProject, sort: "-created" }),
    pb
      .collection("components")
      .getFullList<ComponentRecord>({ filter: byProject, fields: "name,version,direct,dev,via" }),
    pb.collection("issues").getFullList<IssueRecord>({ filter: byProject }),
  ]);
  const build = builds.items[0] ?? null;
  const names = new Set(components.map((c) => c.name));

  const desired = computeDesired({
    build: build ? { nodeVersion: build.nodeVersion, os: build.os } : null,
    lastBuildAt: pbDate(project.lastBuildAt),
    components: components.map((c) => ({ ...c, via: c.via ?? [] })),
    vulns: shared.vulns.filter((v) => names.has(v.name)).map((v) => ({ ...v, aliases: v.aliases ?? [] })),
    node: build && shared.nodeData ? evaluateNode(build.nodeVersion, shared.nodeData, shared.now) : null,
    staleDays: shared.staleDays,
    now: shared.now,
  });

  // Without release data, keep Node issues as they are instead of resolving them.
  const keep = shared.nodeData
    ? []
    : existing.filter((i) => i.kind === "node_security" || i.kind === "node_eol");
  const result = reconcile(
    project.id,
    existing.filter((i) => !keep.includes(i)),
    desired,
    shared.ignores,
    shared.now,
  );

  for (const c of result.creates)
    await pb.collection("issues").create({ project: project.id, ...toRecord(c) });
  for (const u of result.updates) await pb.collection("issues").update(u.id, toRecord(u.patch));
  return result.events;
}

export async function evaluateProject(projectId: string): Promise<IssueEvent[]> {
  return withProjectLock(projectId, async () => {
    const pb = await adminPb();
    const project = await pb.collection("projects").getOne<ProjectRecord>(projectId);
    return evaluateOne(project, await loadShared());
  });
}

export async function evaluateAll(): Promise<IssueEvent[]> {
  const pb = await adminPb();
  const [projects, shared] = await Promise.all([
    pb.collection("projects").getFullList<ProjectRecord>(),
    loadShared(),
  ]);
  const events: IssueEvent[] = [];
  for (const project of projects) {
    events.push(...(await withProjectLock(project.id, () => evaluateOne(project, shared))));
  }
  return events;
}
