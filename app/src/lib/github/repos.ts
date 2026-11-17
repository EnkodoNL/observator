// SPDX-License-Identifier: FSL-1.1-ALv2
import { versionIn } from "@/lib/images/describe";
import type { Severity } from "@/lib/pb/types";
import { compareVersions } from "@/lib/runtimes/endoflife/evaluate";

/* What Observator reads from a public GitHub repository: its releases and security advisories. */

export interface Release {
  /** "2.38.1", from the tag. */
  version: string;
  tag: string;
  published: string;
}

export interface RepoAdvisory {
  /** GHSA-… */
  id: string;
  cve: string | null;
  severity: Severity;
  summary: string;
  url: string;
  /** As the repository wrote it: ">= 1.0.6, <= 2.5.7", or free text. */
  vulnerable: string;
  patched: string;
  updated: string;
}

const text = (v: unknown) => (typeof v === "string" ? v : "");
const SEVERITY: Record<string, Severity> = {
  critical: "critical",
  high: "high",
  medium: "moderate",
  low: "low",
};

/** Published, stable releases with a version in their tag, newest first. */
export function parseReleases(body: unknown): Release[] {
  return (Array.isArray(body) ? body : [])
    .flatMap((r: Record<string, unknown>) => {
      if (r?.draft === true || r?.prerelease === true) return [];
      const tag = text(r.tag_name);
      const version = versionIn(tag.replace(/^[^\d]*(?=\d)/, ""));
      return version && version.includes(".") ? [{ version, tag, published: text(r.published_at) }] : [];
    })
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** The newest release in a line ("1" → newest 1.x, "2.38" → newest 2.38.x), or the newest of all. */
export function newestIn(releases: readonly Release[], line: string | null): Release | null {
  if (!line) return releases[0] ?? null;
  return releases.find((r) => r.version === line || r.version.startsWith(`${line}.`)) ?? null;
}

/** A repository's published advisories, one per affected range. */
export function parseAdvisories(body: unknown): RepoAdvisory[] {
  return (Array.isArray(body) ? body : []).flatMap((a: Record<string, unknown>) => {
    const id = text(a?.ghsa_id);
    if (!/^GHSA-[\w-]+$/.test(id) || a.withdrawn_at) return [];
    const vulns = Array.isArray(a.vulnerabilities) && a.vulnerabilities.length ? a.vulnerabilities : [{}];
    return (vulns as Record<string, unknown>[]).map((v) => ({
      id,
      cve: text(a.cve_id) || null,
      severity: SEVERITY[text(a.severity).toLowerCase()] ?? "unknown",
      summary: text(a.summary).slice(0, 2000),
      url: text(a.html_url),
      vulnerable: text(v?.vulnerable_version_range).slice(0, 200),
      patched: text(v?.patched_versions).slice(0, 200),
      updated: text(a.updated_at),
    }));
  });
}
