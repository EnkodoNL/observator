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
    body: { project: projectId, components },
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
  const lockfileHash = reportHash(files.packageJson, lockfileName, lockfileText);

  const changes: BuildChanges = { added: [], removed: [], changed: [] };
  if (previous && previous.nodeVersion !== meta.nodeVersion) {
    changes.node = { from: previous.nodeVersion, to: meta.nodeVersion };
  }

  let lockfileChanged = previous?.lockfileHash !== lockfileHash;
  let packageCount = previous?.packageCount ?? 0;
  let parseError: string | undefined;
  let directNames: string[] | undefined;

  if (lockfileChanged) {
    try {
      if (!pkg) throw new LockfileError("package.json is not valid JSON");
      const components = lockfileName ? parseLockfile(lockfileName, lockfileText, pkg).components : [];
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
    nodeVersion: meta.nodeVersion,
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
