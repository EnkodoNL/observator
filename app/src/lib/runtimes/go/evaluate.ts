// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Evaluator, RuntimePhase } from "../types";

/** One affected range of a standard-library advisory, as OSV writes its events. */
export type GoRange = { introduced?: string; fixed?: string; last_affected?: string }[];

export interface GoAdvisory {
  id: string;
  ranges: GoRange[];
}

export interface GoData {
  /** Every release, as "1.27.3", "1.20" or "1.28rc1". */
  releases: string[];
  /** Lines with stable releases, newest first; the first two are the supported ones. */
  stableLines: string[];
  /** The release date of each line's first release: "1.27" → "2026-08-19". */
  lineStart: Record<string, string>;
  /** Advisories for the standard library, the package "stdlib" in OSV's Go ecosystem. */
  stdlib: GoAdvisory[];
  fetchedAt: string;
}

/** Go supports the two newest release lines; each gets security fixes until the next-but-one is out. */
const SUPPORTED_LINES = 2;
const DAY = 24 * 3600 * 1000;

interface GoVersion {
  minor: number;
  patch: number;
  pre: string;
}

/** "1.26.2", "1.20" (the first release of 1.20) or "1.28rc1"; Go has stayed on major 1. */
export function parseGo(version: string): GoVersion | null {
  const m = /^1\.(\d+)(?:\.(\d+))?((?:rc|beta)\d+)?(?:-0)?$/.exec(version.replace(/^go/, "").trim());
  return m ? { minor: Number(m[1]), patch: Number(m[2] ?? 0), pre: m[3] ?? "" } : null;
}

/** Negative when a comes first; a pre-release comes before its release. */
export function compareGo(a: string, b: string): number {
  const x = parseGo(a);
  const y = parseGo(b);
  if (!x || !y) return a.localeCompare(b);
  return (
    x.minor - y.minor ||
    x.patch - y.patch ||
    (x.pre === y.pre ? 0 : !x.pre ? 1 : !y.pre ? -1 : x.pre.localeCompare(y.pre, "en", { numeric: true }))
  );
}

export const lineOf = (v: GoVersion) => `1.${v.minor}`;

/** Whether an advisory's ranges include the version, the way OSV reads its events. */
export function affects(advisory: GoAdvisory, version: string): boolean {
  return advisory.ranges.some((events) => {
    let introduced: string | null = null;
    for (const e of events) {
      if (e.introduced !== undefined) introduced = e.introduced === "0" ? "1.0" : e.introduced;
      const end = e.fixed ?? e.last_affected;
      if (end === undefined || introduced === null) continue;
      const inside =
        compareGo(introduced, version) <= 0 &&
        (e.fixed !== undefined ? compareGo(version, end) < 0 : compareGo(version, end) <= 0);
      if (inside) return true;
      introduced = null;
    }
    // Introduced and never fixed.
    return introduced !== null && compareGo(introduced, version) <= 0;
  });
}

/** The fixed versions in the version's own line, above it. */
function fixesInLine(advisory: GoAdvisory, version: GoVersion, raw: string): string[] {
  return advisory.ranges.flatMap((events) =>
    events.flatMap((e) => {
      const fixed = e.fixed ? parseGo(e.fixed) : null;
      return fixed && fixed.minor === version.minor && compareGo(e.fixed!, raw) > 0 ? [e.fixed!] : [];
    }),
  );
}

const PHASE_LABEL: Record<RuntimePhase, string> = {
  current: "Supported",
  active: "Supported",
  maintenance: "Supported",
  eol: "End-of-life",
  unknown: "Unknown line",
};

/** Go's evaluation in the shape every runtime shares. */
export const goEvaluator =
  (data: GoData): Evaluator =>
  (version, now = new Date()) => {
    const v = parseGo(version);
    const supported = data.stableLines.slice(0, SUPPORTED_LINES);
    const newest = data.releases
      .filter((r) => parseGo(r) && !parseGo(r)!.pre && lineOf(parseGo(r)!) === supported[0])
      .sort(compareGo)
      .at(-1);
    const base = {
      runtime: "go",
      label: "Go",
      version,
      codename: null,
      eolSoon: false,
      latestSupported: newest ?? null,
    };
    // A release candidate, or a version the release data does not know.
    if (!v || v.pre || !data.stableLines.includes(lineOf(v)))
      return {
        ...base,
        line: v ? lineOf(v) : version,
        phase: "unknown",
        phaseLabel: PHASE_LABEL.unknown,
        end: null,
        daysToEol: null,
        latestInLine: null,
        securityUpdate: null,
        patchAvailable: false,
      };

    const line = lineOf(v);
    const inLine = data.releases
      .filter((r) => {
        const p = parseGo(r);
        return p && !p.pre && p.minor === v.minor;
      })
      .sort(compareGo);
    const latestInLine = inLine.at(-1) ?? null;
    const phase: RuntimePhase =
      line === supported[0] ? "current" : supported.includes(line) ? "active" : "eol";
    // A line loses support when the next-but-one comes out: 1.25 ended with 1.27.0.
    const end = phase === "eol" ? (data.lineStart[`1.${v.minor + SUPPORTED_LINES}`] ?? null) : null;

    const hits = data.stdlib.filter((a) => affects(a, version));
    const releases = [...new Set(hits.flatMap((a) => fixesInLine(a, v, version)))].sort(compareGo);
    return {
      ...base,
      line,
      phase,
      phaseLabel: PHASE_LABEL[phase],
      end,
      daysToEol: end ? Math.ceil((Date.parse(end) - now.getTime()) / DAY) : null,
      latestInLine,
      securityUpdate:
        releases.length > 0 && latestInLine && compareGo(latestInLine, version) > 0
          ? { target: latestInLine, releases }
          : null,
      patchAvailable: latestInLine !== null && compareGo(latestInLine, version) > 0,
    };
  };

/** The release lines with a stable release, newest first, from go.dev/dl's full list. */
export function compactReleases(list: { version: string; stable: boolean }[]): {
  releases: string[];
  stableLines: string[];
} {
  const releases = list.map((r) => r.version.replace(/^go/, "")).filter((v) => parseGo(v));
  const stableLines = [
    ...new Set(
      list
        .filter((r) => r.stable)
        .map((r) => parseGo(r.version))
        .filter((v): v is GoVersion => v !== null && !v.pre)
        .sort((a, b) => b.minor - a.minor)
        .map(lineOf),
    ),
  ];
  return { releases, stableLines };
}

/** "go1.27.0 (released 2026-08-19)" on go.dev/doc/devel/release, per line. */
export function lineStarts(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/go(1\.\d+)(?:\.0)? \(released (\d{4}-\d{2}-\d{2})\)/g)) out[m[1]] ??= m[2];
  return out;
}

/** OSV records to the ranges that concern the standard library. */
export function compactStdlib(
  vulns: {
    id: string;
    withdrawn?: string;
    affected?: { package?: { name?: string; ecosystem?: string }; ranges?: { events: GoRange }[] }[];
  }[],
): GoAdvisory[] {
  return vulns
    .filter((v) => !v.withdrawn)
    .map((v) => ({
      id: v.id,
      ranges: (v.affected ?? [])
        .filter((a) => a.package?.name === "stdlib" && a.package.ecosystem === "Go")
        .flatMap((a) => (a.ranges ?? []).map((r) => r.events)),
    }))
    .filter((a) => a.ranges.length > 0);
}
