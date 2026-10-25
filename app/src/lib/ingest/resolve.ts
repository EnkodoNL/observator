// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { randomToken, sha256 } from "@/lib/crypto";
import { findIngestKey, findIngestKeyForIp } from "@/lib/data/ingest-keys";
import { getProjectByKey, slugify, uniqueSlug } from "@/lib/data/projects";
import { adminPb, isUniqueViolation } from "@/lib/pb/admin";
import type { IngestKeyRecord, ProjectRecord } from "@/lib/pb/types";
import { RateLimiter } from "@/lib/rate-limit";
import { IngestError } from "./request";
import { displayName } from "./source";

export type KeyMatch = { kind: "project"; project: ProjectRecord } | { kind: "shared"; key: IngestKeyRecord };

/** Which project or shared key a bearer key belongs to. */
export async function matchKey(bearer: string): Promise<KeyMatch | null> {
  const project = await getProjectByKey(bearer);
  if (project) return { kind: "project", project };
  const key = await findIngestKey(bearer);
  return key ? { kind: "shared", key } : null;
}

/** A report without a key: the shared key whose IP allowlist has this address, if any. */
export async function matchAddress(ip: string): Promise<KeyMatch | null> {
  if (ip === "unknown") return null;
  const key = await findIngestKeyForIp(ip);
  return key ? { kind: "shared", key } : null;
}

const g = globalThis as typeof globalThis & { __createLimiter?: RateLimiter };
// A leaked shared key must not be able to flood the dashboard with projects.
const createLimiter = (g.__createLimiter ??= RateLimiter.perWindow(30, 3600_000));

/**
 * Finds or creates the project a shared key reports for. The key only ever writes to
 * projects it created itself; a project with that name made another way is refused.
 */
export async function resolveSharedProject(
  key: IngestKeyRecord,
  name: string,
  ip: string,
): Promise<{ project: ProjectRecord; created: boolean }> {
  const pb = await adminPb();
  const instance = key.splitByIp ? ip : "";
  const mine = pb.filter("ingestKey = {:key} && sourceName = {:name} && instance = {:instance}", {
    key: key.id,
    name,
    instance,
  });
  const existing = await pb.collection("projects").getList<ProjectRecord>(1, 1, { filter: mine });
  if (existing.items[0]) return { project: existing.items[0], created: false };

  const conflict = await pb.collection("projects").getList<ProjectRecord>(1, 1, {
    filter: pb.filter(
      "ingestKey != {:key} && (sourceName = {:name} || (ingestKey = '' && (name = {:name} || slug = {:slug})))",
      { key: key.id, name, slug: slugify(name) },
    ),
    fields: "id,name",
  });
  if (conflict.items[0]) {
    throw new IngestError(
      409,
      `project "${name}" already exists and is not managed by this shared key; report with that project's own key, or set another OBSERVATOR_PROJECT`,
    );
  }
  if (!createLimiter.take(key.id))
    throw new IngestError(429, "too many new projects for this shared key; try again later");

  try {
    const project = await pb.collection("projects").create<ProjectRecord>({
      name: displayName(name, instance),
      slug: await uniqueSlug(slugify(instance ? `${name}-${instance}` : name)),
      // Never used: these projects report through the shared key. Rotating gives them their own.
      apiKeyHash: sha256(randomToken(32)),
      apiKeyPrefix: "shared",
      badgeToken: randomToken(18),
      ingestKey: key.id,
      sourceName: name,
      instance,
    });
    return { project, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await pb.collection("projects").getList<ProjectRecord>(1, 1, { filter: mine });
    if (!raced.items[0]) throw err;
    return { project: raced.items[0], created: false };
  }
}
