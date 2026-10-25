// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { newSharedKey, sha256 } from "@/lib/crypto";
import { type AllowEntry, matchEntry } from "@/lib/ingest/allowlist";
import { kvGet, kvSet } from "@/lib/kv";
import { adminPb, isNotFound, pbDate, toPbDate } from "@/lib/pb/admin";
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

/** The shared key whose IP allowlist contains this address (at most one: entries never overlap). */
export async function findIngestKeyForIp(ip: string): Promise<IngestKeyRecord | null> {
  const pb = await adminPb();
  const keys = await pb.collection("ingest_keys").getFullList<IngestKeyRecord>({ sort: "created" });
  return keys.find((k) => matchEntry(ip, cidrs(k))) ?? null;
}

const cidrs = (k: IngestKeyRecord) => (k.allowedIps ?? []).map((e) => e.cidr);

export async function setAllowedIps(id: string, entries: AllowEntry[]): Promise<void> {
  const pb = await adminPb();
  await pb.collection("ingest_keys").update(id, { allowedIps: entries });
}

export interface RefusedReport {
  ip: string;
  /** OBSERVATOR_PROJECT as sent, to recognise the build. */
  project: string;
  count: number;
  lastAt: string;
}

const REFUSED_KEY = "ingest:refused";
const REFUSED_MAX = 20;
const REFUSED_DAYS = 7;

/**
 * Remembers reports without a key from addresses on no allowlist, so the settings page can
 * offer to add them. Only the address and the project name are kept, never the files.
 */
export async function recordRefused(ip: string, project: string): Promise<void> {
  const list = (await kvGet<RefusedReport[]>(REFUSED_KEY)) ?? [];
  const now = new Date();
  const prev = list.find((r) => r.ip === ip);
  const entry: RefusedReport = {
    ip,
    project: project || prev?.project || "",
    count: (prev?.count ?? 0) + 1,
    lastAt: toPbDate(now),
  };
  const cutoff = now.getTime() - REFUSED_DAYS * 86_400_000;
  const rest = list.filter((r) => r.ip !== ip && (pbDate(r.lastAt)?.getTime() ?? 0) > cutoff);
  await kvSet(REFUSED_KEY, [entry, ...rest].slice(0, REFUSED_MAX));
}

/** Recent refusals from addresses that are still on no allowlist. */
export async function listRefused(keys: IngestKeyRecord[]): Promise<RefusedReport[]> {
  const list = (await kvGet<RefusedReport[]>(REFUSED_KEY)) ?? [];
  const cutoff = Date.now() - REFUSED_DAYS * 86_400_000;
  return list.filter(
    (r) => (pbDate(r.lastAt)?.getTime() ?? 0) > cutoff && !keys.some((k) => matchEntry(r.ip, cidrs(k))),
  );
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
