// SPDX-License-Identifier: FSL-1.1-ALv2
import { DepGraph } from "./graph";
import { LockfileError, type PackageJson, type ParseResult } from "./types";

interface NpmEntry {
  name?: string;
  version?: string;
  dev?: boolean;
  devOptional?: boolean;
  link?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface NpmLock {
  lockfileVersion?: number;
  packages?: Record<string, NpmEntry>;
}

const NM = "node_modules/";

/** Node's resolution: look in nested node_modules first, then walk up to the root. */
function resolve(packages: Record<string, NpmEntry>, from: string, dep: string): string | null {
  let base = from;
  for (;;) {
    const candidate = base ? `${base}/${NM}${dep}` : `${NM}${dep}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const i = base.lastIndexOf(`/${NM}`);
    base = i === -1 ? "" : base.slice(0, i);
  }
}

/** package-lock.json (and npm-shrinkwrap.json), lockfileVersion 2 and 3. */
export function parseNpmLock(text: string, pkg: PackageJson): ParseResult {
  let lock: NpmLock;
  try {
    lock = JSON.parse(text);
  } catch {
    throw new LockfileError("package-lock.json is not valid JSON");
  }
  if (!lock.packages || (lock.lockfileVersion ?? 1) < 2) {
    throw new LockfileError(
      "package-lock.json lockfileVersion 1 is not supported; regenerate it with npm 7 or newer",
    );
  }

  const packages = lock.packages;
  const graph = new DepGraph();
  for (const [path, entry] of Object.entries(packages)) {
    if (!path.includes(NM) || entry.link || !entry.version) continue;
    const name = entry.name ?? path.slice(path.lastIndexOf(NM) + NM.length);
    graph.addNode(path, name, entry.version);
    // devOptional: a dev dependency that is also an optional dependency of a production
    // package, so `npm ci --omit=dev` still installs it.
    graph.devFlags.set(path, entry.dev === true);
  }

  for (const [path, entry] of Object.entries(packages)) {
    if (!graph.nodes.has(path)) continue;
    const deps = { ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies };
    for (const dep of Object.keys(deps)) {
      const target = resolve(packages, path, dep);
      if (target) graph.addEdge(path, target);
    }
  }

  const root = packages[""] ?? {};
  const prod = {
    ...(root.dependencies ?? pkg.dependencies),
    ...(root.optionalDependencies ?? pkg.optionalDependencies),
  };
  const dev = root.devDependencies ?? pkg.devDependencies ?? {};
  for (const dep of Object.keys(prod)) {
    const id = resolve(packages, "", dep);
    if (id) graph.prodRoots.add(id);
  }
  for (const dep of Object.keys(dev)) {
    const id = resolve(packages, "", dep);
    if (id) graph.devRoots.add(id);
  }
  // Workspace packages ("apps/web"): their dependencies resolve from their own folder. npm's
  // dev flags already account for them; as roots they name the way in.
  for (const [path, entry] of Object.entries(packages)) {
    if (!path || path.includes(NM)) continue;
    for (const [deps, into] of [
      [{ ...entry.dependencies, ...entry.optionalDependencies }, graph.prodRoots],
      [entry.devDependencies ?? {}, graph.devRoots],
    ] as const) {
      for (const dep of Object.keys(deps)) {
        const id = resolve(packages, path, dep);
        if (id) into.add(id);
      }
    }
  }

  return { type: "npm", components: graph.toComponents() };
}
