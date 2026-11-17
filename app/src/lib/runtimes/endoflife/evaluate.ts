// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Evaluator, RuntimeEvaluation, RuntimePhase } from "../types";

/** One release line as endoflife.date lists it (https://endoflife.date/docs/api). */
export interface EolCycle {
  cycle: string;
  releaseDate?: string;
  /** The end-of-life date, or true/false when the line has none. */
  eol: string | boolean;
  latest?: string;
  latestReleaseDate?: string;
  /** true, or the date the line became LTS. */
  lts?: string | boolean;
}

export interface EolData {
  product: string;
  cycles: EolCycle[];
  fetchedAt: string;
}

const DAY = 24 * 3600 * 1000;
export const EOL_WARNING_DAYS = 30;

const clean = (version: string) => version.trim().replace(/^v/i, "");
const parts = (version: string) =>
  clean(version)
    .split(".")
    .map((p) => Number.parseInt(p, 10));

/** Compares dotted versions numerically: 11.10 is newer than 11.9. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The release line a version belongs to: the longest cycle it starts with ("11.8.9" → "11.8",
 * "16.4" → "16"). A version that names only a line, as a moving image tag does, finds that line
 * or, for a bare major ("11"), the newest line under it; its patch is then unknown.
 */
export function cycleFor(
  version: string,
  cycles: readonly EolCycle[],
): { cycle: EolCycle; versionKnown: boolean } | null {
  const v = clean(version);
  if (!/^\d+(\.\d+)*$/.test(v)) return null;
  const containing = cycles
    .filter((c) => v === c.cycle || v.startsWith(`${c.cycle}.`))
    .sort((a, b) => b.cycle.length - a.cycle.length);
  if (containing[0]) return { cycle: containing[0], versionKnown: v !== containing[0].cycle };
  const under = cycles
    .filter((c) => c.cycle.startsWith(`${v}.`))
    .sort((a, b) => compareVersions(b.cycle, a.cycle));
  return under[0] ? { cycle: under[0], versionKnown: false } : null;
}

const isEol = (c: EolCycle, now: Date) =>
  c.eol === true || (typeof c.eol === "string" && Date.parse(c.eol) <= now.getTime());

const isLts = (c: EolCycle, now: Date) =>
  c.lts === true || (typeof c.lts === "string" && Date.parse(c.lts) <= now.getTime());

/** A version against endoflife.date's lines, in the shape every runtime shares. */
export function evaluateEol(
  product: string,
  label: string,
  version: string,
  data: EolData,
  now = new Date(),
): RuntimeEvaluation {
  const match = cycleFor(version, data.cycles);
  const supported = data.cycles
    .filter((c) => !isEol(c, now) && c.latest)
    .sort((a, b) => Number(isLts(b, now)) - Number(isLts(a, now)) || compareVersions(b.cycle, a.cycle));
  const base = {
    runtime: product,
    label,
    version: clean(version),
    codename: null,
    latestSupported: supported[0]?.latest ?? null,
  };
  if (!match) {
    return {
      ...base,
      line: clean(version),
      phase: "unknown",
      phaseLabel: "Unknown line",
      end: null,
      daysToEol: null,
      eolSoon: false,
      latestInLine: null,
      securityUpdate: null,
      patchAvailable: false,
      versionKnown: false,
    };
  }
  const { cycle, versionKnown } = match;
  const end = typeof cycle.eol === "string" ? cycle.eol : null;
  const daysToEol = end ? Math.ceil((Date.parse(end) - now.getTime()) / DAY) : null;
  const phase: RuntimePhase = isEol(cycle, now) ? "eol" : isLts(cycle, now) ? "active" : "current";
  const latest = cycle.latest ?? null;
  // endoflife.date has no security flag: a newer patch is offered as an update, not as a fix.
  const patchAvailable = versionKnown && latest !== null && compareVersions(latest, version) > 0;
  return {
    ...base,
    line: cycle.cycle,
    phase,
    phaseLabel: phase === "eol" ? "End-of-life" : phase === "active" ? "LTS" : "Supported",
    end,
    daysToEol,
    eolSoon: phase !== "eol" && daysToEol !== null && daysToEol <= EOL_WARNING_DAYS,
    latestInLine: latest,
    securityUpdate: patchAvailable ? { target: latest!, releases: [] } : null,
    patchAvailable,
    versionKnown,
  };
}

export const eolEvaluator =
  (product: string, label: string, data: EolData): Evaluator =>
  (version, now) =>
    evaluateEol(product, label, version, data, now);
