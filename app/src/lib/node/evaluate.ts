// SPDX-License-Identifier: FSL-1.1-ALv2
import semver from "semver";

export interface NodeRelease {
  version: string;
  date: string;
  lts: string | false;
  security: boolean;
}

export interface ScheduleEntry {
  start: string;
  lts?: string;
  maintenance?: string;
  end: string;
  codename?: string;
}

export interface NodeData {
  releases: NodeRelease[];
  schedule: Record<string, ScheduleEntry>;
  fetchedAt: string;
}

export type LinePhase = "current" | "active-lts" | "maintenance" | "eol" | "unknown";

export interface NodeEvaluation {
  version: string;
  major: number;
  phase: LinePhase;
  codename: string | null;
  end: string | null;
  /** Days until end-of-life; negative once past it. */
  daysToEol: number | null;
  eolSoon: boolean;
  latestInLine: string | null;
  securityUpdate: { target: string; releases: string[] } | null;
  patchAvailable: boolean;
  /** Newest version on the newest LTS line, for "move to" advice. */
  latestLts: string | null;
}

const DAY = 24 * 3600 * 1000;
export const EOL_WARNING_DAYS = 30;

/** Compacts the nodejs.org/dist/index.json payload to what Observator needs. */
export function compactIndex(
  index: { version: string; date: string; lts: string | boolean; security: boolean }[],
): NodeRelease[] {
  return index
    .filter((r) => semver.valid(r.version))
    .map((r) => ({
      version: r.version.replace(/^v/, ""),
      date: r.date,
      lts: typeof r.lts === "string" ? r.lts : false,
      security: Boolean(r.security),
    }));
}

function phaseOf(entry: ScheduleEntry | undefined, now: Date): LinePhase {
  if (!entry) return "unknown";
  const t = now.getTime();
  if (t >= Date.parse(entry.end)) return "eol";
  if (entry.maintenance && t >= Date.parse(entry.maintenance)) return "maintenance";
  if (entry.lts && t >= Date.parse(entry.lts)) return "active-lts";
  return "current";
}

export function evaluateNode(version: string, data: NodeData, now = new Date()): NodeEvaluation {
  const parsed = semver.parse(version);
  const major = parsed?.major ?? 0;
  const entry = data.schedule[`v${major}`];
  const phase = phaseOf(entry, now);
  const daysToEol = entry ? Math.ceil((Date.parse(entry.end) - now.getTime()) / DAY) : null;

  const line = data.releases
    .filter((r) => semver.major(r.version) === major)
    .sort((a, b) => semver.rcompare(a.version, b.version));
  const latestInLine = line[0]?.version ?? null;
  const newer = parsed ? line.filter((r) => semver.gt(r.version, parsed)) : [];
  const securityReleases = newer
    .filter((r) => r.security)
    .map((r) => r.version)
    .sort(semver.compare);

  const ltsReleases = data.releases
    .filter((r) => r.lts)
    .sort((a, b) => semver.rcompare(a.version, b.version));

  return {
    version,
    major,
    phase,
    codename: entry?.codename || null,
    end: entry?.end ?? null,
    daysToEol,
    eolSoon: phase !== "eol" && daysToEol !== null && daysToEol <= EOL_WARNING_DAYS,
    latestInLine,
    securityUpdate:
      securityReleases.length > 0 && latestInLine
        ? { target: latestInLine, releases: securityReleases }
        : null,
    patchAvailable: newer.length > 0,
    latestLts: ltsReleases[0]?.version ?? null,
  };
}

export const PHASE_LABEL: Record<LinePhase, string> = {
  current: "Current",
  "active-lts": "Active LTS",
  maintenance: "Maintenance LTS",
  eol: "End-of-life",
  unknown: "Unknown line",
};
