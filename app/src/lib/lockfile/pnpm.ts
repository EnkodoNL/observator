// SPDX-License-Identifier: FSL-1.1-ALv2
import { posix } from "node:path";
import { parse } from "yaml";
import { DepGraph } from "./graph";
import { LockfileError, type PackageJson, type ParseResult } from "./types";

type DepMap = Record<string, string | { specifier?: string; version: string }>;

interface Importer {
  dependencies?: DepMap;
  devDependencies?: DepMap;
  optionalDependencies?: DepMap;
}

interface PnpmLock extends Importer {
  lockfileVersion?: string | number;
  importers?: Record<string, Importer>;
  packages?: Record<string, { dev?: boolean; dependencies?: DepMap; optionalDependencies?: DepMap }>;
  snapshots?: Record<string, { dependencies?: DepMap; optionalDependencies?: DepMap }>;
}

function versionOf(value: DepMap[string]): string {
  return typeof value === "string" ? value : value.version;
}

/** "name@1.2.3(peer@1.0.0)" or "/name@1.2.3" -> { name, version } */
function splitKey(key: string): { name: string; version: string } | null {
  let k = key.startsWith("/") ? key.slice(1) : key;
  const paren = k.indexOf("(");
  if (paren !== -1) k = k.slice(0, paren);
  const at = k.lastIndexOf("@");
  if (at <= 0) return null;
  return { name: k.slice(0, at), version: k.slice(at + 1) };
}

const isLocal = (v: string) => /^(link|file|workspace):/.test(v);

const depNames = (x: Importer | PackageJson) =>
  [
    ...Object.keys(x.dependencies ?? {}),
    ...Object.keys(x.optionalDependencies ?? {}),
    ...Object.keys(x.devDependencies ?? {}),
  ]
    .sort()
    .join("\n");

/**
 * The workspace packages whose dependencies are in the image: the one package the reported
 * package.json matches by dependency names, when that is not the workspace root. Otherwise
 * (an image built from the root) all of them, so what any package needs in production counts
 * as production.
 */
function selectImporters(importers: Record<string, Importer>, pkg: PackageJson): string[] {
  const keys = Object.keys(importers);
  const wanted = depNames(pkg);
  const matches = keys.filter((k) => depNames(importers[k]) === wanted);
  return matches.length === 1 && matches[0] !== "." ? matches : keys;
}

/** pnpm-lock.yaml, lockfile formats 6.x (pnpm 8) and 9.x (pnpm 9 and later). */
export function parsePnpmLock(text: string, pkg: PackageJson = {}): ParseResult {
  let lock: PnpmLock;
  try {
    lock = parse(text, { maxAliasCount: 0 }) ?? {};
  } catch {
    throw new LockfileError("pnpm-lock.yaml is not valid YAML");
  }

  const major = parseInt(String(lock.lockfileVersion ?? "0"), 10);
  if (major < 6) {
    throw new LockfileError(
      `pnpm lockfile version ${lock.lockfileVersion} is not supported; use pnpm 8 or newer`,
    );
  }

  const v9 = major >= 9 || lock.snapshots !== undefined;
  // v9: snapshot keys look like "name@1.0.0(peer)"; aliases refer to "real@1.0.0".
  // v6: package keys look like "/name@1.0.0(peer)"; aliases refer to "/real@1.0.0".
  const refKey = (dep: string, version: string): string => {
    if (v9) return /^\d/.test(version) ? `${dep}@${version}` : version;
    return version.startsWith("/") ? version : `/${dep}@${version}`;
  };

  const table = (v9 ? lock.snapshots : lock.packages) ?? {};
  const graph = new DepGraph();
  for (const key of Object.keys(table)) {
    const parsed = splitKey(key);
    if (parsed) graph.addNode(key, parsed.name, parsed.version);
  }
  const importers: Record<string, Importer> = lock.importers ?? { ".": lock };
  const selected = selectImporters(importers, pkg);
  // v6 dev flags cover the whole workspace; with one workspace package selected they can be wrong.
  if (!v9 && selected.length === Object.keys(importers).length) {
    for (const [key, entry] of Object.entries(lock.packages ?? {})) {
      if (typeof entry?.dev === "boolean") graph.devFlags.set(key, entry.dev);
    }
  }

  for (const [key, entry] of Object.entries(table)) {
    for (const [dep, value] of Object.entries({ ...entry?.dependencies, ...entry?.optionalDependencies })) {
      const version = versionOf(value);
      if (!isLocal(version)) graph.addEdge(key, refKey(dep, version));
    }
  }

  // A link to another workspace package brings in that package's production dependencies.
  const seen = new Set<string>();
  const addRoots = (from: string, deps: DepMap | undefined, into: Set<string>) => {
    for (const [dep, value] of Object.entries(deps ?? {})) {
      const version = versionOf(value);
      if (!isLocal(version)) {
        into.add(refKey(dep, version));
        continue;
      }
      if (!version.startsWith("link:")) continue;
      const target = posix.normalize(posix.join(from, version.slice("link:".length))) || ".";
      const linked = importers[target];
      const id = `${target}\0${into === graph.prodRoots}`;
      if (!linked || seen.has(id)) continue;
      seen.add(id);
      addRoots(target, linked.dependencies, into);
      addRoots(target, linked.optionalDependencies, into);
    }
  };
  for (const key of selected) {
    const importer = importers[key];
    addRoots(key, importer.dependencies, graph.prodRoots);
    addRoots(key, importer.optionalDependencies, graph.prodRoots);
    addRoots(key, importer.devDependencies, graph.devRoots);
  }

  return { type: "pnpm", components: graph.toComponents() };
}
