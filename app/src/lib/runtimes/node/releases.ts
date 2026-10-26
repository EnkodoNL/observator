// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { kvGet, kvSet } from "@/lib/kv";
import { compactIndex, type NodeData, type ScheduleEntry } from "./evaluate";

const INDEX_URL = "https://nodejs.org/dist/index.json";
const SCHEDULE_URL = "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json";
const KV_KEY = "node:data";

const g = globalThis as typeof globalThis & { __nodeData?: NodeData };

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "observator" },
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Downloads the release index and schedule, and caches them in memory and in kv. */
export async function refreshNodeData(timeoutMs = 15_000): Promise<NodeData> {
  const [index, schedule] = await Promise.all([
    fetchJson<Parameters<typeof compactIndex>[0]>(INDEX_URL, timeoutMs),
    fetchJson<Record<string, ScheduleEntry>>(SCHEDULE_URL, timeoutMs),
  ]);
  const data: NodeData = { releases: compactIndex(index), schedule, fetchedAt: new Date().toISOString() };
  if (data.releases.length === 0) throw new Error("empty Node release index");
  g.__nodeData = data;
  await kvSet(KV_KEY, data);
  return data;
}

/**
 * Cached release data: memory, then kv (survives restarts), then the network.
 * Returns null when nothing is cached and nodejs.org is unreachable.
 */
export async function getNodeData(fetchTimeoutMs = 5_000): Promise<NodeData | null> {
  if (g.__nodeData) return g.__nodeData;
  const stored = await kvGet<NodeData>(KV_KEY);
  if (stored?.releases?.length) {
    g.__nodeData = stored;
    return stored;
  }
  try {
    return await refreshNodeData(fetchTimeoutMs);
  } catch (err) {
    console.warn("[node] could not load release data:", String(err));
    return null;
  }
}
