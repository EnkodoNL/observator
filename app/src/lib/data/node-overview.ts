// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import semver from "semver";
import { getOverview, type ProjectSummary } from "@/lib/data/views";
import { evaluateNode, type NodeEvaluation } from "@/lib/node/evaluate";
import { getNodeData } from "@/lib/node/releases";

export interface NodeGroup {
  version: string;
  evaluation: NodeEvaluation | null;
  projects: ProjectSummary[];
}

export interface NodeOverview {
  /** Newest version first. */
  groups: NodeGroup[];
  /** Projects on a version with a newer security release in its line. */
  affected: number;
  /** The versions those projects should move to. */
  targets: string[];
}

/** All projects grouped by the Node version of their latest build. */
export async function nodeOverview(): Promise<NodeOverview> {
  const [items, nodeData] = await Promise.all([getOverview(), getNodeData()]);
  const groups = new Map<string, NodeGroup>();
  for (const item of items) {
    if (!item.latest) continue;
    const v = item.latest.nodeVersion;
    const group = groups.get(v) ?? {
      version: v,
      evaluation: nodeData ? evaluateNode(v, nodeData) : null,
      projects: [],
    };
    group.projects.push(item);
    groups.set(v, group);
  }
  const sorted = [...groups.values()].sort((a, b) => semver.rcompare(a.version, b.version));
  const behind = sorted.filter((g) => g.evaluation?.securityUpdate);
  return {
    groups: sorted,
    affected: behind.reduce((n, g) => n + g.projects.length, 0),
    targets: [...new Set(behind.map((g) => g.evaluation!.securityUpdate!.target))],
  };
}
