// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { kvGet, kvSet } from "@/lib/kv";
import { compactReleases, compactStdlib, lineStarts, type GoData } from "./evaluate";

const RELEASES_URL = "https://go.dev/dl/?mode=json&include=all";
const HISTORY_URL = "https://go.dev/doc/devel/release";
const OSV_QUERY_URL = "https://api.osv.dev/v1/query";
const KV_KEY = "go:data";
const MAX_PAGES = 10;

const g = globalThis as typeof globalThis & { __goData?: GoData };

async function fetchOk(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "observator", ...init.headers },
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

/** Every advisory for the standard library: OSV answers a query without a version with all of them. */
async function stdlibAdvisories(timeoutMs: number) {
  const vulns: Parameters<typeof compactStdlib>[0] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchOk(OSV_QUERY_URL, timeoutMs, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: { name: "stdlib", ecosystem: "Go" }, page_token: pageToken }),
    });
    const body = (await res.json()) as { vulns?: typeof vulns; next_page_token?: string };
    vulns.push(...(body.vulns ?? []));
    pageToken = body.next_page_token;
    if (!pageToken) break;
  }
  return compactStdlib(vulns);
}

/** Downloads Go's releases, their dates and the standard library's advisories, and caches them. */
export async function refreshGoData(timeoutMs = 15_000): Promise<GoData> {
  const [releases, history, stdlib] = await Promise.all([
    fetchOk(RELEASES_URL, timeoutMs).then((r) => r.json() as Promise<{ version: string; stable: boolean }[]>),
    fetchOk(HISTORY_URL, timeoutMs).then((r) => r.text()),
    stdlibAdvisories(timeoutMs),
  ]);
  const data: GoData = {
    ...compactReleases(releases),
    lineStart: lineStarts(history),
    stdlib,
    fetchedAt: new Date().toISOString(),
  };
  if (data.stableLines.length === 0) throw new Error("empty Go release list");
  g.__goData = data;
  await kvSet(KV_KEY, data);
  return data;
}

/** Cached data: memory, then kv (survives restarts), then the network; null when none of them has it. */
export async function getGoData(fetchTimeoutMs = 5_000): Promise<GoData | null> {
  if (g.__goData) return g.__goData;
  const stored = await kvGet<GoData>(KV_KEY);
  if (stored?.stableLines?.length) {
    g.__goData = stored;
    return stored;
  }
  try {
    return await refreshGoData(fetchTimeoutMs);
  } catch (err) {
    console.warn("[go] could not load release data:", String(err));
    return null;
  }
}
