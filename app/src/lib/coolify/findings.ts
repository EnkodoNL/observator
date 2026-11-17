// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { COOLIFY_ECOSYSTEM } from "@/lib/ecosystems";
import type { Component } from "@/lib/lockfile/types";
import { adminPb, toPbDate } from "@/lib/pb/admin";
import type { Severity, VulnerabilityRecord } from "@/lib/pb/types";
import type { CoolifyFinding } from "./client";

/*
 * Coolify's own image scan as advisories. Only findings with a fixed version become one: what has
 * no fix yet is counted, not reported, so Observator stays quiet until there is something to do.
 * Their packages get the ecosystem "coolify:<type>" (coolify:deb, coolify:npm, ...): OSV is never
 * asked about them, the sync writes their rows itself.
 */

export { isCoolifyEcosystem } from "@/lib/ecosystems";

const SEVERITY: Record<string, Severity> = {
  critical: "critical",
  high: "high",
  medium: "moderate",
  moderate: "moderate",
  low: "low",
  negligible: "low",
};

const usable = (f: CoolifyFinding) => Boolean(f.fixedIn) && !f.ignored;

/** The packages of fixable findings, once each. */
export function findingComponents(findings: readonly CoolifyFinding[]): Component[] {
  const out = new Map<string, Component>();
  for (const f of findings.filter(usable)) {
    const ecosystem = `${COOLIFY_ECOSYSTEM}${f.type}`;
    out.set(`${ecosystem}:${f.package}@${f.version}`, {
      name: f.package,
      version: f.version,
      direct: false,
      dev: false,
      via: [],
      ecosystem,
    });
  }
  return [...out.values()].sort((a, b) =>
    `${a.ecosystem}:${a.name}`.localeCompare(`${b.ecosystem}:${b.name}`),
  );
}

/** How many findings have a fix, and how many do not (counted only). */
export const findingCounts = (findings: readonly CoolifyFinding[]) => ({
  fixable: findings.filter(usable).length,
  unfixable: findings.filter((f) => !f.fixedIn && !f.ignored).length,
});

const rowKey = (r: { ecosystem: string; name: string; version: string; osvId: string }) =>
  `${r.ecosystem}:${r.name}@${r.version}#${r.osvId}`;

/**
 * The vulnerability rows of Coolify's findings for one sync: written as they come, and the ones
 * no resource had any more removed at the end, but only after a sync that read every scan.
 */
export class FindingStore {
  private rows = new Map<string, VulnerabilityRecord>();
  private seen = new Set<string>();

  static async open(): Promise<FindingStore> {
    const store = new FindingStore();
    const pb = await adminPb();
    const rows = await pb
      .collection("vulnerabilities")
      .getFullList<VulnerabilityRecord>({ filter: `ecosystem ~ "${COOLIFY_ECOSYSTEM}%"` });
    for (const row of rows) store.rows.set(rowKey(row), row);
    return store;
  }

  /** Writes a resource's fixable findings; true when a row was added or changed. */
  async write(findings: readonly CoolifyFinding[]): Promise<boolean> {
    const pb = await adminPb();
    let changed = false;
    for (const f of findings.filter(usable)) {
      const data = {
        name: f.package,
        version: f.version,
        ecosystem: `${COOLIFY_ECOSYSTEM}${f.type}`,
        osvId: f.id,
        aliases: f.aliases.filter((a) => a !== f.id),
        severity: SEVERITY[f.severity] ?? "unknown",
        summary: `${f.kev ? "Known to be exploited (CISA KEV). " : ""}${f.title || f.id}`.slice(0, 2000),
        fixedIn: f.fixedIn,
        url: f.url,
      };
      const key = rowKey(data);
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const row = this.rows.get(key);
      const same =
        row &&
        row.severity === data.severity &&
        row.summary === data.summary &&
        row.fixedIn === data.fixedIn &&
        row.url === data.url &&
        JSON.stringify(row.aliases ?? []) === JSON.stringify(data.aliases);
      if (same) continue;
      const record = { ...data, modified: "", checkedAt: toPbDate(new Date()) };
      if (row) await pb.collection("vulnerabilities").update(row.id, record);
      else await pb.collection("vulnerabilities").create(record);
      changed = true;
    }
    return changed;
  }

  /** Keeps a resource's rows whose scan could not be read this time. */
  keep(components: readonly Component[]): void {
    const kept = new Set(components.map((c) => `${c.ecosystem}:${c.name}@${c.version}`));
    for (const [key] of this.rows) if (kept.has(key.split("#")[0])) this.seen.add(key);
  }

  /** Removes the rows no resource had; only when every scan was read. */
  async finish(complete: boolean): Promise<number> {
    if (!complete) return 0;
    const pb = await adminPb();
    let removed = 0;
    for (const [key, row] of this.rows) {
      if (this.seen.has(key)) continue;
      await pb.collection("vulnerabilities").delete(row.id);
      removed++;
    }
    return removed;
  }
}
