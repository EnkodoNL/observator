// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { adminPb, toPbDate } from "@/lib/pb/admin";
import type { VulnerabilityRecord } from "@/lib/pb/types";
import { getVuln, osvUrl, queryBatch, type OsvQuery } from "./client";
import { fixedIn } from "./fixed";
import { osvSeverity } from "./severity";
import type { OsvVuln } from "./types";
import { mapLimit } from "@/lib/map-limit";
import { OSV_NAMES } from "@/lib/lockfile/go";
import { GITHUB_ECOSYSTEM, isCoolifyEcosystem } from "@/lib/ecosystems";
import { repoAdvisories } from "@/lib/github/client";
import { fixedFor, inRange } from "@/lib/github/ranges";

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

/** The names OSV knows a package by: its own, and the old path of a moved Go module. */
const osvNames = (p: OsvQuery) => {
  const old = p.ecosystem === "Go" ? OSV_NAMES[p.name] : undefined;
  return old ? [p.name, old] : [p.name];
};

/**
 * Checks ecosystem:name@version pairs against OSV and brings the vulnerabilities cache in line:
 * new advisories are added, changed ones updated, and withdrawn or no longer matching
 * ones removed. Only pairs that were checked are touched.
 */
export async function checkPackages(
  pairs: OsvQuery[],
  signal?: AbortSignal,
): Promise<{ checked: number; vulnerable: number }> {
  const all = [...new Map(pairs.map((p) => [pairKey(p), p])).values()];
  // An app in a Coolify service is checked against its GitHub repository's own advisories;
  // the findings of Coolify's image scan are written by the sync and never asked for here.
  const github = all.filter((p) => p.ecosystem === GITHUB);
  const osv = all.filter((p) => p.ecosystem !== GITHUB && !isCoolifyEcosystem(p.ecosystem));
  const a = osv.length ? await checkOsv(osv, signal) : { checked: 0, vulnerable: 0 };
  const b = github.length ? await checkGitHub(github) : { checked: 0, vulnerable: 0 };
  return { checked: a.checked + b.checked, vulnerable: a.vulnerable + b.vulnerable };
}

/** The ecosystem of an app named by its GitHub repository (owner/repo). */
export const GITHUB = GITHUB_ECOSYSTEM;

/**
 * Apps against their repository's security advisories. A range the repository wrote as free text
 * that cannot be read matches nothing here; the project's Setup tab lists it to check by hand.
 * An unreadable repository leaves its rows as they were.
 */
async function checkGitHub(pairs: OsvQuery[]): Promise<{ checked: number; vulnerable: number }> {
  const pb = await adminPb();
  const existing = await pb
    .collection("vulnerabilities")
    .getFullList<VulnerabilityRecord>({ filter: pb.filter("ecosystem = {:e}", { e: GITHUB }) });
  const now = toPbDate(new Date());
  let vulnerable = 0;
  for (const pair of pairs) {
    const advisories = await repoAdvisories(pair.name);
    if ("error" in advisories) continue;
    const version = pair.version.replace(/^v/, "");
    const hits = new Map<string, (typeof advisories)[number]>();
    for (const a of advisories)
      if (inRange(version, a.vulnerable) === true && !hits.has(a.id)) hits.set(a.id, a);
    const rows = existing.filter((r) => r.name === pair.name && r.version === pair.version);
    for (const a of hits.values()) {
      const data = {
        name: pair.name,
        version: pair.version,
        ecosystem: GITHUB,
        osvId: a.id,
        aliases: a.cve ? [a.cve] : [],
        severity: a.severity,
        summary: a.summary,
        fixedIn: fixedFor(version, a.patched),
        url: /^https:\/\//.test(a.url) ? a.url : "",
        modified: a.updated ? toPbDate(new Date(a.updated)) : "",
        checkedAt: now,
      };
      const row = rows.find((r) => r.osvId === a.id);
      if (row) await pb.collection("vulnerabilities").update(row.id, data);
      else await pb.collection("vulnerabilities").create(data);
    }
    for (const row of rows) if (!hits.has(row.osvId)) await pb.collection("vulnerabilities").delete(row.id);
    if (hits.size) vulnerable++;
  }
  return { checked: pairs.length, vulnerable };
}

/** OSV for every ecosystem it knows (npm, Go). */
async function checkOsv(
  unique: OsvQuery[],
  signal?: AbortSignal,
): Promise<{ checked: number; vulnerable: number }> {
  // A moved module is asked under both names; its hits remember which, for the fixed version.
  const queries = unique.flatMap((pair, i) => osvNames(pair).map((name) => ({ i, osvName: name })));
  const answers = await queryBatch(
    queries.map(({ i, osvName }) => ({ ...unique[i], name: osvName })),
    signal,
  );
  const results: { id: string; modified: string; osvName: string }[][] = unique.map(() => []);
  queries.forEach(({ i, osvName }, q) => {
    for (const hit of answers[q])
      if (!results[i].some((h) => h.id === hit.id)) results[i].push({ ...hit, osvName });
  });
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
        fixedIn: fixedIn(vuln, { ...pair, name: hit.osvName }),
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
