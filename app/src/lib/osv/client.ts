// SPDX-License-Identifier: FSL-1.1-ALv2
import type { OsvVuln } from "./types";

const API = "https://api.osv.dev/v1";
const BATCH = 1000;

export interface OsvQuery {
  name: string;
  version: string;
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "observator" },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OSV ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Vulnerability ids (and their modified dates) per query, in input order. */
export async function queryBatch(
  queries: OsvQuery[],
  signal?: AbortSignal,
): Promise<{ id: string; modified: string }[][]> {
  const out: { id: string; modified: string }[][] = queries.map(() => []);
  for (let offset = 0; offset < queries.length; offset += BATCH) {
    let pending = queries.slice(offset, offset + BATCH).map((q, i) => ({ q, index: offset + i, token: "" }));
    while (pending.length > 0) {
      const res = await post<{
        results: { vulns?: { id: string; modified: string }[]; next_page_token?: string }[];
      }>(
        "/querybatch",
        {
          queries: pending.map(({ q, token }) => ({
            package: { name: q.name, ecosystem: "npm" },
            version: q.version,
            ...(token ? { page_token: token } : {}),
          })),
        },
        signal,
      );
      const next: typeof pending = [];
      res.results.forEach((result, i) => {
        const item = pending[i];
        out[item.index].push(...(result.vulns ?? []));
        if (result.next_page_token) next.push({ ...item, token: result.next_page_token });
      });
      pending = next;
    }
  }
  return out;
}

export async function getVuln(id: string, signal?: AbortSignal): Promise<OsvVuln> {
  const res = await fetch(`${API}/vulns/${encodeURIComponent(id)}`, {
    headers: { "user-agent": "observator" },
    signal: signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OSV vulns/${id}: HTTP ${res.status}`);
  return (await res.json()) as OsvVuln;
}

export const osvUrl = (id: string) => `https://osv.dev/vulnerability/${encodeURIComponent(id)}`;
