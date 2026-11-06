// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { sha256 } from "@/lib/crypto";
import { adminPb, toPbDate } from "@/lib/pb/admin";
import {
  chooseLockfile,
  LockfileError,
  parseGoBinaries,
  parseLockfile,
  parsePackageJson,
  type Component,
  type GoResult,
  type LockfileName,
} from "@/lib/lockfile";
import type { BuildChanges, BuildRecord, LockfileType, ProjectRecord } from "@/lib/pb/types";
import { diffComponents, diffRuntimes } from "./changes";
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

/** Bump when the parsers classify differently, so the next build parses an unchanged lockfile again. */
const PARSER_VERSION = 2;

/**
 * Identifies a package.json + lockfile pair, and the Go programs' modules when there are any; a
 * build with the same hash changes no packages. Without Go the hash is what it always was.
 */
export function reportHash(
  packageJson: string,
  lockfileName: string | null,
  lockfileText: string,
  goBinaries: string | null = null,
): string {
  const go = goBinaries === null ? "" : `\0go\0${goBinaries}`;
  return sha256(`${PARSER_VERSION}\0${packageJson}\0${lockfileName ?? ""}\0${lockfileText}${go}`);
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
    body: {
      project: projectId,
      components: components.map((c) => ({ ...c, ecosystem: c.ecosystem ?? "npm" })),
    },
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
  const lockfileType: LockfileType = lockfileName
    ? LOCKFILE_TYPE[lockfileName](lockfileText)
    : files.goBinaries !== null
      ? "go"
      : "none";
  const lockfileHash = reportHash(files.packageJson ?? "", lockfileName, lockfileText, files.goBinaries);
  // A bad file is reported as a parse error below, with the other packages kept as they were.
  const go = (() => {
    if (files.goBinaries === null) return null;
    try {
      return parseGoBinaries(files.goBinaries);
    } catch (err) {
      if (err instanceof LockfileError) return err;
      throw err;
    }
  })();
  const goApp: GoResult | null = go instanceof LockfileError ? null : go;

  // For information: which release of the app this build is; a Go app names its main module.
  const appName = (typeof pkg?.name === "string" ? pkg.name : (goApp?.main ?? "")).slice(0, 512);
  const appVersion = (typeof pkg?.version === "string" ? pkg.version : (goApp?.version ?? "")).slice(0, 64);

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
      if (go instanceof LockfileError) throw go;
      // npm packages need a package.json; Go modules come from the programs themselves. One set,
      // because storing it replaces everything the project had.
      const components = [
        ...(pkg && lockfileName ? parseLockfile(lockfileName, lockfileText, pkg).components : []),
        ...(goApp?.components ?? []),
      ];
      Object.assign(changes, diffComponents(await currentComponents(project.id), components));
      await replaceComponents(project.id, components);
      packageCount = components.length;
      // For the npm latest-version cache.
      directNames = components.filter((c) => c.direct && !c.ecosystem).map((c) => c.name);
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
