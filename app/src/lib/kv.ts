// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { adminPb, isNotFound, isUniqueViolation, pbDate, toPbDate } from "@/lib/pb/admin";
import type { KvRecord } from "@/lib/pb/types";

async function find(key: string): Promise<KvRecord | null> {
  const pb = await adminPb();
  try {
    return await pb.collection("kv").getFirstListItem<KvRecord>(pb.filter("key = {:key}", { key }));
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const record = await find(key);
  if (!record) return null;
  const expires = pbDate(record.expiresAt);
  if (expires && expires.getTime() < Date.now()) return null;
  return record.value as T;
}

export async function kvSet(key: string, value: unknown, expiresAt?: Date): Promise<void> {
  const pb = await adminPb();
  const data = { key, value, expiresAt: expiresAt ? toPbDate(expiresAt) : "" };
  const existing = await find(key);
  if (existing) {
    await pb.collection("kv").update(existing.id, data);
    return;
  }
  try {
    await pb.collection("kv").create(data);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await find(key);
    if (raced) await pb.collection("kv").update(raced.id, data);
  }
}

export async function kvDelete(key: string): Promise<void> {
  const pb = await adminPb();
  const existing = await find(key);
  if (existing) await pb.collection("kv").delete(existing.id);
}

/**
 * Cross-process lock using the unique index on kv.key as an atomic claim. Expired locks
 * (a crashed holder) are taken over. Returns a release function, or null if held.
 */
export async function tryLock(name: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
  const pb = await adminPb();
  const key = `lock:${name}`;
  const expiresAt = toPbDate(new Date(Date.now() + ttlMs));
  let record: KvRecord;
  try {
    record = await pb.collection("kv").create<KvRecord>({ key, value: { pid: process.pid }, expiresAt });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const held = await find(key);
    const expires = pbDate(held?.expiresAt);
    if (!held || (expires && expires.getTime() > Date.now())) return null;
    await pb
      .collection("kv")
      .delete(held.id)
      .catch(() => undefined);
    try {
      record = await pb.collection("kv").create<KvRecord>({ key, value: { pid: process.pid }, expiresAt });
    } catch {
      return null;
    }
  }
  return async () => {
    await pb
      .collection("kv")
      .delete(record.id)
      .catch(() => undefined);
  };
}
