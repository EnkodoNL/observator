// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { kvGet, kvSet } from "@/lib/kv";
import type { EolCycle, EolData } from "./evaluate";

const url = (product: string) => `https://endoflife.date/api/${product}.json`;
const kvKey = (product: string) => `eol:${product}`;

const g = globalThis as typeof globalThis & { __eolData?: Map<string, EolData> };
const memory = (g.__eolData ??= new Map());

/** Keeps the fields Observator uses from one cycle, refusing anything that is not one. */
function toCycle(raw: unknown): EolCycle | null {
  const c = raw as Record<string, unknown> | null;
  if (typeof c?.cycle !== "string" || !/^\d+(\.\d+)*$/.test(c.cycle)) return null;
  const eol = typeof c.eol === "string" || typeof c.eol === "boolean" ? c.eol : false;
  const lts = typeof c.lts === "string" || typeof c.lts === "boolean" ? c.lts : false;
  return {
    cycle: c.cycle,
    eol,
    lts,
    ...(typeof c.latest === "string" ? { latest: c.latest } : {}),
    ...(typeof c.releaseDate === "string" ? { releaseDate: c.releaseDate } : {}),
    ...(typeof c.latestReleaseDate === "string" ? { latestReleaseDate: c.latestReleaseDate } : {}),
  };
}

/** Downloads a product's release lines from endoflife.date and caches them in memory and kv. */
export async function refreshEolData(product: string, timeoutMs = 15_000): Promise<EolData> {
  const res = await fetch(url(product), {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json", "user-agent": "observator" },
  });
  if (!res.ok) throw new Error(`${url(product)}: HTTP ${res.status}`);
  const body: unknown = await res.json();
  const cycles = (Array.isArray(body) ? body : []).flatMap((c) => toCycle(c) ?? []);
  if (cycles.length === 0) throw new Error(`no release lines for ${product}`);
  const data: EolData = { product, cycles, fetchedAt: new Date().toISOString() };
  memory.set(product, data);
  await kvSet(kvKey(product), data);
  return data;
}

/** Cached release lines: memory, then kv, then the network; null when none can be had. */
export async function getEolData(product: string, fetchTimeoutMs = 5_000): Promise<EolData | null> {
  const cached = memory.get(product);
  if (cached) return cached;
  const stored = await kvGet<EolData>(kvKey(product));
  if (stored?.cycles?.length) {
    memory.set(product, stored);
    return stored;
  }
  try {
    return await refreshEolData(product, fetchTimeoutMs);
  } catch (err) {
    console.warn(`[endoflife] could not load ${product}:`, String(err));
    return null;
  }
}
