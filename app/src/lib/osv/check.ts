// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { adminPb, toPbDate } from "@/lib/pb/admin";
import type { VulnerabilityRecord } from "@/lib/pb/types";
import { getVuln, osvUrl, queryBatch, type OsvQuery } from "./client";
import { fixedIn } from "./fixed";
import { osvSeverity } from "./severity";
import type { OsvVuln } from "./types";
import { mapLimit } from "@/lib/map-limit";

const g = globalThis as typeof globalThis & { __osvDetails?: Map<string, OsvVuln> };
const details = (g.__osvDetails ??= new Map());

async function detail(id: string, modified: string, signal?: AbortSignal): Promise<OsvVuln> {
  const key = `${id}@${modified}`;
  const cached = details.get(key);
  if (cached) return cached;
  const vuln = await getVuln(id, signal);
  if (details.size > 5000) details.clear();
  details.set(key, vuln);
  return vuln;
}

const pairKey = (p: OsvQuery) => `${p.ecosystem}:${p.name}@${p.version}`;

/**
 * Checks ecosystem:name@version pairs against OSV and brings the vulnerabilities cache in line:
 * new advisories are added, changed ones updated, and withdrawn or no longer matching
 * ones removed. Only pairs that were checked are touched.
 */
export async function checkPackages(
  pairs: OsvQuery[],
  signal?: AbortSignal,
): Promise<{ checked: number; vulnerable: number }> {
  const unique = [...new Map(pairs.map((p) => [pairKey(p), p])).values()];
  if (unique.length === 0) return { checked: 0, vulnerable: 0 };

  const results = await queryBatch(unique, signal);
  const pb = await adminPb();
  const existing = await pb.collection("vulnerabilities").getFullList<VulnerabilityRecord>();
  const byPair = new Map<string, VulnerabilityRecord[]>();
  for (const row of existing) {
    const key = pairKey(row);
    byPair.set(key, [...(byPair.get(key) ?? []), row]);
  }

  const needed = new Map<string, string>();
  unique.forEach((pair, i) => {
    const rows = byPair.get(pairKey(pair)) ?? [];
    for (const hit of results[i]) {
      const row = rows.find((r) => r.osvId === hit.id);
      if (!row || row.modified.slice(0, 19) !== hit.modified.replace("T", " ").slice(0, 19))
        needed.set(hit.id, hit.modified);
    }
  });
  const fetched = new Map<string, OsvVuln>();
  await mapLimit([...needed], 8, async ([id, modified]) => {
    fetched.set(id, await detail(id, modified, signal));
  });

  const now = toPbDate(new Date());
  let vulnerable = 0;
  for (const [i, pair] of unique.entries()) {
    const rows = byPair.get(pairKey(pair)) ?? [];
    const hits = results[i];
    const live = new Set<string>();

    for (const hit of hits) {
      const vuln = fetched.get(hit.id);
      const row = rows.find((r) => r.osvId === hit.id);
      if (vuln?.withdrawn) continue;
      live.add(hit.id);
      if (!vuln) {
        if (row) await pb.collection("vulnerabilities").update(row.id, { checkedAt: now });
        continue;
      }
      const data = {
        name: pair.name,
        version: pair.version,
        ecosystem: pair.ecosystem,
        osvId: vuln.id,
        aliases: vuln.aliases ?? [],
        severity: osvSeverity(vuln),
        summary: (vuln.summary || vuln.details || "").slice(0, 2000),
        fixedIn: fixedIn(vuln, pair),
        url: osvUrl(vuln.id),
        modified: vuln.modified ? toPbDate(new Date(vuln.modified)) : "",
        checkedAt: now,
      };
      if (row) await pb.collection("vulnerabilities").update(row.id, data);
      else await pb.collection("vulnerabilities").create(data);
    }
    for (const row of rows) {
      if (!live.has(row.osvId)) await pb.collection("vulnerabilities").delete(row.id);
    }
    if (live.size > 0) vulnerable++;
  }
  return { checked: unique.length, vulnerable };
}

export async function checkProject(projectId: string, signal?: AbortSignal): Promise<void> {
  const pb = await adminPb();
  const components = await pb.collection("components").getFullList<OsvQuery>({
    filter: pb.filter("project = {:id}", { id: projectId }),
    fields: "ecosystem,name,version",
  });
  await checkPackages(components, signal);
  await pb.collection("projects").update(projectId, { vulnsCheckedAt: toPbDate(new Date()) });
}

/** Daily re-check of every package currently in use by any project. */
export async function checkAllProjects(): Promise<{ checked: number; vulnerable: number }> {
  const pb = await adminPb();
  const components = await pb.collection("components").getFullList<OsvQuery & { project: string }>({
    fields: "ecosystem,name,version,project",
  });
  const result = await checkPackages(components);
  const now = toPbDate(new Date());
  for (const id of new Set(components.map((c) => c.project))) {
    await pb.collection("projects").update(id, { vulnsCheckedAt: now });
  }
  return result;
}
