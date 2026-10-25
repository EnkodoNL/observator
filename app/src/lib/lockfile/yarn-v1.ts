// SPDX-License-Identifier: FSL-1.1-ALv2
import { DepGraph } from "./graph";
import { LockfileError, splitSpec, type PackageJson, type ParseResult } from "./types";

interface Entry {
  specs: string[];
  version?: string;
  deps: [string, string][];
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}

/** Real package name of a spec, following `npm:` aliases ("alias@npm:real@1.0.0"). */
function realName(spec: string): string {
  const [name, range] = splitSpec(spec);
  if (range.startsWith("npm:")) return splitSpec(range.slice(4))[0];
  return name;
}

function parseEntries(text: string): Entry[] {
  const entries: Entry[] = [];
  let current: Entry | null = null;
  let inDeps = false;

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();

    if (indent === 0) {
      if (!line.endsWith(":")) throw new LockfileError("unexpected line in yarn.lock");
      current = { specs: line.slice(0, -1).split(/,\s*/).map(unquote), deps: [] };
      entries.push(current);
      inDeps = false;
      continue;
    }
    if (!current) throw new LockfileError("unexpected indentation in yarn.lock");

    if (indent === 2) {
      inDeps = line === "dependencies:" || line === "optionalDependencies:";
      const match = /^(version)\s+(.+)$/.exec(line);
      if (match) current.version = unquote(match[2]);
      continue;
    }
    if (indent >= 4 && inDeps) {
      const match = /^("(?:[^"\\]|\\.)+"|\S+)\s+(.+)$/.exec(line);
      if (match) current.deps.push([unquote(match[1]), unquote(match[2])]);
    }
  }
  return entries;
}

/** yarn.lock written by yarn 1 ("# yarn lockfile v1"). */
export function parseYarnV1(text: string, pkg: PackageJson): ParseResult {
  const entries = parseEntries(text);
  const graph = new DepGraph();
  const bySpec = new Map<string, string>();

  entries.forEach((entry, i) => {
    if (!entry.version || entry.specs.length === 0) return;
    const id = String(i);
    graph.addNode(id, realName(entry.specs[0]), entry.version);
    for (const spec of entry.specs) bySpec.set(spec, id);
  });

  entries.forEach((entry, i) => {
    for (const [name, range] of entry.deps) {
      const target = bySpec.get(`${name}@${range}`);
      if (target) graph.addEdge(String(i), target);
    }
  });

  const roots = (deps: Record<string, string> | undefined, into: Set<string>) => {
    for (const [name, range] of Object.entries(deps ?? {})) {
      const id = bySpec.get(`${name}@${range}`);
      if (id) into.add(id);
    }
  };
  roots(pkg.dependencies, graph.prodRoots);
  roots(pkg.optionalDependencies, graph.prodRoots);
  roots(pkg.devDependencies, graph.devRoots);

  return { type: "yarn-v1", components: graph.toComponents() };
}
