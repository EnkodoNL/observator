// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { sha256 } from "@/lib/crypto";
import { adminPb, toPbDate } from "@/lib/pb/admin";
import {
  chooseLockfile,
  LockfileError,
  parseLockfile,
  parsePackageJson,
  type Component,
  type LockfileName,
} from "@/lib/lockfile";
import type { BuildChanges, BuildRecord, LockfileType, ProjectRecord } from "@/lib/pb/types";
import type { Runtime } from "@/lib/runtimes/types";
import { diffComponents } from "./changes";
import type { IngestFiles, IngestMeta } from "./request";

export interface IngestOutcome {
  build: BuildRecord;
  previous: BuildRecord | null;
  lockfileName: LockfileName | null;
  lockfileChanged: boolean;
  packageCount: number;
  /** Direct dependencies of a newly parsed lockfile (for the npm latest-version cache). */
  directNames?: string[];
  parseError?: string;
}

const LOCKFILE_TYPE: Record<LockfileName, (text: string) => LockfileType> = {
  "package-lock.json": () => "npm",
  "pnpm-lock.yaml": () => "pnpm",
  "yarn.lock": (text) => (/^__metadata:/m.test(text) ? "yarn-berry" : "yarn-v1"),
};

/** Identifies a package.json + lockfile pair; a build with the same hash changes no packages. */
export function reportHash(packageJson: string, lockfileName: string | null, lockfileText: string): string {
  return sha256(`${packageJson}\0${lockfileName ?? ""}\0${lockfileText}`);
}

/** Runtimes whose version changed between two builds, plus ones that appeared or disappeared. */
export function diffRuntimes(
  before: readonly Runtime[],
  after: readonly Runtime[],
): NonNullable<BuildChanges["runtimes"]> {
  const out: NonNullable<BuildChanges["runtimes"]> = [];
  for (const a of after) {
    const b = before.find((r) => r.name === a.name);
    if (!b) out.push({ name: a.name, from: null, to: a.version });
    else if (b.version !== a.version) out.push({ name: a.name, from: b.version, to: a.version });
  }
  for (const b of before)
    if (!after.some((r) => r.name === b.name)) out.push({ name: b.name, from: b.version, to: null });
  return out;
}

export async function latestBuild(projectId: string): Promise<BuildRecord | null> {
  const pb = await adminPb();
  const res = await pb.collection("builds").getList<BuildRecord>(1, 1, {
    filter: pb.filter("project = {:id}", { id: projectId }),
    sort: "-created",
  });
  return res.items[0] ?? null;
}

async function currentComponents(projectId: string): Promise<{ name: string; version: string }[]> {
  const pb = await adminPb();
  return pb.collection("components").getFullList({
    filter: pb.filter("project = {:id}", { id: projectId }),
    fields: "name,version",
  });
}

async function replaceComponents(projectId: string, components: Component[]): Promise<void> {
  const pb = await adminPb();
  await pb.send("/api/observator/components/replace", {
    method: "POST",
    // npm is the only package ecosystem with a lockfile parser so far.
    body: { project: projectId, components: components.map((c) => ({ ...c, ecosystem: "npm" })) },
  });
}

/**
 * Records one report. Always creates a build; replaces the component set only when the
 * package.json + lockfile pair changed and parsed cleanly. Raw files are never stored.
 */
export async function recordBuild(
  project: ProjectRecord,
  files: IngestFiles,
  meta: IngestMeta,
  sourceIp = "",
): Promise<IngestOutcome> {
  const pb = await adminPb();
  const previous = await latestBuild(project.id);

  const pkg = (() => {
    if (files.packageJson === null) return null;
    try {
      return parsePackageJson(files.packageJson);
    } catch {
      return null;
    }
  })();
  const available = Object.keys(files.lockfiles) as LockfileName[];
  const lockfileName = pkg ? chooseLockfile(pkg, available) : (available[0] ?? null);
  const lockfileText = lockfileName ? files.lockfiles[lockfileName]! : "";
  const lockfileType: LockfileType = lockfileName ? LOCKFILE_TYPE[lockfileName](lockfileText) : "none";
  const lockfileHash = reportHash(files.packageJson ?? "", lockfileName, lockfileText);

  // For information: which release of the app this build is.
  const appName = typeof pkg?.name === "string" ? pkg.name.slice(0, 214) : "";
  const appVersion = typeof pkg?.version === "string" ? pkg.version.slice(0, 64) : "";

  const changes: BuildChanges = { added: [], removed: [], changed: [] };
  if (previous) {
    const runtimeChanges = diffRuntimes(previous.runtimes ?? [], meta.runtimes);
    if (runtimeChanges.length) changes.runtimes = runtimeChanges;
    if (previous.appVersion && appVersion && previous.appVersion !== appVersion)
      changes.app = { from: previous.appVersion, to: appVersion };
  }

  let lockfileChanged = previous?.lockfileHash !== lockfileHash;
  let packageCount = previous?.packageCount ?? 0;
  let parseError: string | undefined;
  let directNames: string[] | undefined;

  if (lockfileChanged) {
    try {
      if (files.packageJson !== null && !pkg) throw new LockfileError("package.json is not valid JSON");
      // Without a package.json (an image of another language) there are no packages to track.
      const components = pkg && lockfileName ? parseLockfile(lockfileName, lockfileText, pkg).components : [];
      Object.assign(changes, diffComponents(await currentComponents(project.id), components));
      await replaceComponents(project.id, components);
      packageCount = components.length;
      directNames = components.filter((c) => c.direct).map((c) => c.name);
    } catch (err) {
      if (!(err instanceof LockfileError)) throw err;
      parseError = err.message;
      lockfileChanged = false;
    }
  }

  const build = await pb.collection("builds").create<BuildRecord>({
    project: project.id,
    runtimes: meta.runtimes,
    appName,
    appVersion,
    platform: meta.platform,
    arch: meta.arch,
    os: meta.os,
    lockfileType,
    // A failed parse keeps the old components, so keep the old hash too: the next
    // report with a fixed lockfile must count as a change.
    lockfileHash: parseError ? (previous?.lockfileHash ?? "") : lockfileHash,
    packageCount,
    changes,
    error: parseError ?? "",
    sourceIp,
  });
  await pb.collection("projects").update(project.id, {
    lastBuildAt: toPbDate(new Date()),
    // The build says which labels it has; a report without the header leaves them as they are.
    ...(meta.labels ? { buildLabels: meta.labels.labels } : {}),
  });

  return { build, previous, lockfileName, lockfileChanged, packageCount, directNames, parseError };
}
