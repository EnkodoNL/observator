// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomToken, sha256 } from "@/lib/crypto";
import { uniqueSlug } from "@/lib/data/projects";
import { env } from "@/lib/env";
import { analyzeInBackground, analyzeInline } from "@/lib/ingest/analyze";
import { latestBuild, recordBuild, reportHash } from "@/lib/ingest/ingest";
import { normalizePlatform, type IngestMeta } from "@/lib/ingest/request";
import { kvGet, kvSet } from "@/lib/kv";
import { publish } from "@/lib/notify/publish";
import { adminPb, isNotFound, toPbDate } from "@/lib/pb/admin";
import type { ProjectRecord } from "@/lib/pb/types";

/** Where package.json and package-lock.json are: copied to ./self in the image, the app root in dev. */
function selfDir(): string | null {
  for (const dir of [join(process.cwd(), "self"), process.cwd()]) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "package-lock.json"))) return dir;
  }
  return null;
}

function osId(): string {
  try {
    return /^ID="?([a-z0-9._-]+)/m.exec(readFileSync("/etc/os-release", "utf8"))?.[1] ?? "";
  } catch {
    return "";
  }
}

async function selfProject(): Promise<ProjectRecord> {
  const pb = await adminPb();
  const known = await kvGet<{ id: string }>("self:project");
  if (known) {
    try {
      return await pb.collection("projects").getOne<ProjectRecord>(known.id);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
  const project = await pb.collection("projects").create<ProjectRecord>({
    name: "Observator",
    slug: await uniqueSlug("observator"),
    // Never used: Observator reports itself from inside the process, without HTTP.
    apiKeyHash: sha256(randomToken(32)),
    apiKeyPrefix: "self",
    badgeToken: randomToken(18),
  });
  await kvSet("self:project", { id: project.id });
  return project;
}

/**
 * Observator reports the runtime it actually runs on (Node) and its own packages, straight into
 * its database. Runs at every start and daily; records a build only when something changed,
 * otherwise it just marks the project as seen so it never counts as stale while running.
 */
export async function reportSelf(): Promise<"recorded" | "unchanged" | "skipped"> {
  if (!env().OBSERVATOR_SELF) return "skipped";
  const dir = selfDir();
  if (!dir) return "skipped";
  const packageJson = readFileSync(join(dir, "package.json"), "utf8");
  const lockfile = readFileSync(join(dir, "package-lock.json"), "utf8");
  const meta: IngestMeta = {
    runtimes: [{ name: "node", version: process.versions.node }],
    invalidRuntimes: [],
    ...normalizePlatform(`${process.platform}/${process.arch}`),
    os: osId(),
    failOn: { severity: null, runtimes: [] },
    // Observator's own project: labels only by hand.
    labels: null,
  };

  const project = await selfProject();
  const latest = await latestBuild(project.id);
  const unchanged =
    latest &&
    JSON.stringify(latest.runtimes ?? []) === JSON.stringify(meta.runtimes) &&
    latest.os === meta.os &&
    latest.arch === meta.arch &&
    latest.lockfileHash === reportHash(packageJson, "package-lock.json", lockfile);
  if (unchanged) {
    const pb = await adminPb();
    await pb.collection("projects").update(project.id, { lastBuildAt: toPbDate(new Date()) });
    return "unchanged";
  }

  const files = { packageJson, lockfiles: { "package-lock.json": lockfile } };
  const outcome = await recordBuild(project, files, meta);
  const analysis = await analyzeInline(project, outcome, meta);
  await publish(await analyzeInBackground(project.id, analysis));
  return "recorded";
}
