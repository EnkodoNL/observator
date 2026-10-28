// SPDX-License-Identifier: FSL-1.1-ALv2
import { parse } from "yaml";
import { DepGraph } from "./graph";
import { LockfileError, splitSpec, type PackageJson, type ParseResult } from "./types";

interface BerryEntry {
  version?: string | number;
  resolution?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const REGISTRY_PROTOCOLS = new Set(["npm", "patch"]);

/** yarn.lock written by yarn 2+ (YAML with a __metadata block). */
export function parseYarnBerry(text: string, pkg: PackageJson): ParseResult {
  let doc: Record<string, BerryEntry>;
  try {
    doc = parse(text, { maxAliasCount: 0 }) ?? {};
  } catch {
    throw new LockfileError("yarn.lock is not valid YAML");
  }

  const graph = new DepGraph();
  const byDescriptor = new Map<string, string>();
  const workspaces = new Map<string, { root: boolean }>();

  for (const [key, entry] of Object.entries(doc)) {
    if (key === "__metadata" || !entry || typeof entry !== "object") continue;
    const descriptors = key.split(/,\s*/);
    for (const d of descriptors) byDescriptor.set(d, key);

    const resolution = String(entry.resolution ?? descriptors[0]);
    const [name, ref] = splitSpec(resolution);
    const protocol = ref.slice(0, ref.indexOf(":"));
    if (protocol === "workspace") workspaces.set(key, { root: ref === "workspace:." });
    if (!REGISTRY_PROTOCOLS.has(protocol) || entry.version === undefined) continue;
    graph.addNode(key, name, String(entry.version));
  }

  const lookup = (name: string, range: string): string | undefined =>
    byDescriptor.get(`${name}@${range}`) ?? byDescriptor.get(`${name}@npm:${range}`);

  for (const [key, entry] of Object.entries(doc)) {
    if (!graph.nodes.has(key)) continue;
    for (const [dep, range] of Object.entries({ ...entry.dependencies, ...entry.optionalDependencies })) {
      const target = lookup(dep, String(range));
      if (target) graph.addEdge(key, target);
    }
  }

  // A workspace entry merges prod and dev dependencies; only the reported package.json tells
  // them apart. The other workspaces' dependencies all count as production, and so do those of
  // a workspace that is linked in.
  const devNames = new Set(Object.keys(pkg.devDependencies ?? {}));
  const prodNames = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
  const depsOf = (key: string) => ({ ...doc[key].dependencies, ...doc[key].optionalDependencies });
  const wanted = [...prodNames, ...devNames].sort().join("\n");
  const reported = [...workspaces.keys()].filter((k) => Object.keys(depsOf(k)).sort().join("\n") === wanted);
  const own = reported.length === 1 ? reported[0] : null;
  const selected = own && !workspaces.get(own)!.root ? [own] : [...workspaces.keys()];

  const seen = new Set<string>();
  const addRoots = (key: string, split: boolean) => {
    for (const [dep, range] of Object.entries(depsOf(key))) {
      const id = lookup(dep, String(range));
      if (!id) continue;
      if (workspaces.has(id)) {
        if (seen.has(id)) continue;
        seen.add(id);
        addRoots(id, false);
      } else if (split && devNames.has(dep) && !prodNames.has(dep)) graph.devRoots.add(id);
      else graph.prodRoots.add(id);
    }
  };
  for (const key of selected) {
    seen.add(key);
    addRoots(key, key === own || (own === null && workspaces.get(key)!.root));
  }

  return { type: "yarn-berry", components: graph.toComponents() };
}
