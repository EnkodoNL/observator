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
  let rootKey: string | null = null;

  for (const [key, entry] of Object.entries(doc)) {
    if (key === "__metadata" || !entry || typeof entry !== "object") continue;
    const descriptors = key.split(/,\s*/);
    for (const d of descriptors) byDescriptor.set(d, key);

    const resolution = String(entry.resolution ?? descriptors[0]);
    const [name, ref] = splitSpec(resolution);
    const protocol = ref.slice(0, ref.indexOf(":"));
    if (protocol === "workspace" && ref === "workspace:.") rootKey = key;
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

  // The workspace entry merges prod and dev dependencies; package.json tells them apart.
  const root = rootKey ? doc[rootKey] : undefined;
  const devNames = new Set(Object.keys(pkg.devDependencies ?? {}));
  const prodNames = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
  for (const [dep, range] of Object.entries(root?.dependencies ?? {})) {
    const id = lookup(dep, String(range));
    if (!id) continue;
    if (prodNames.has(dep) || !devNames.has(dep)) graph.prodRoots.add(id);
    else graph.devRoots.add(id);
  }

  return { type: "yarn-berry", components: graph.toComponents() };
}
