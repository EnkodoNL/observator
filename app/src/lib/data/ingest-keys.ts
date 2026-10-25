// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { newSharedKey, sha256 } from "@/lib/crypto";
import { adminPb, isNotFound, toPbDate } from "@/lib/pb/admin";
import type { IngestKeyRecord, ProjectRecord } from "@/lib/pb/types";

export async function listIngestKeys(): Promise<(IngestKeyRecord & { projects: number })[]> {
  const pb = await adminPb();
  const [keys, projects] = await Promise.all([
    pb.collection("ingest_keys").getFullList<IngestKeyRecord>({ sort: "created" }),
    pb.collection("projects").getFullList<ProjectRecord>({ filter: "ingestKey != ''", fields: "ingestKey" }),
  ]);
  return keys.map((k) => ({ ...k, projects: projects.filter((p) => p.ingestKey === k.id).length }));
}

export async function createIngestKey(
  name: string,
  splitByIp: boolean,
  createdBy: string,
): Promise<{ record: IngestKeyRecord; key: string }> {
  const pb = await adminPb();
  const { key, hash, prefix } = newSharedKey();
  const record = await pb
    .collection("ingest_keys")
    .create<IngestKeyRecord>({ name, keyHash: hash, keyPrefix: prefix, splitByIp, createdBy });
  return { record, key };
}

export async function findIngestKey(key: string): Promise<IngestKeyRecord | null> {
  const pb = await adminPb();
  try {
    return await pb
      .collection("ingest_keys")
      .getFirstListItem<IngestKeyRecord>(pb.filter("keyHash = {:h}", { h: sha256(key) }));
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function touchIngestKey(id: string, ip: string): Promise<void> {
  const pb = await adminPb();
  await pb.collection("ingest_keys").update(id, { lastUsedAt: toPbDate(new Date()), lastUsedIp: ip });
}

/**
 * Revoking a key stops it working; the projects it created stay, unlinked, and only accept
 * reports with their own project key from then on.
 */
export async function revokeIngestKey(id: string): Promise<void> {
  const pb = await adminPb();
  const linked = await pb.collection("projects").getFullList<ProjectRecord>({
    filter: pb.filter("ingestKey = {:id}", { id }),
    fields: "id",
  });
  for (const p of linked) await pb.collection("projects").update(p.id, { ingestKey: "" });
  await pb.collection("ingest_keys").delete(id);
}
