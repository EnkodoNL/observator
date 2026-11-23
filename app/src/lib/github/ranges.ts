// SPDX-License-Identifier: FSL-1.1-ALv2
import { compareVersions } from "@/lib/runtimes/endoflife/evaluate";

/*
 * The version ranges of GitHub repository advisories. A repository writes them by hand, so they
 * come as ">= 1.0.6, <= 2.5.7", "< 1.40.1", "<=2.0.0", or as free text such as
 * "current (≥ 2.3.1, latest)". What can be read is read; what cannot is said to be unclear,
 * never taken as "not affected".
 */

type Op = ">=" | ">" | "<=" | "<" | "=";
const PAIR = /(>=|<=|>|<|=)\s*v?(\d+(?:\.\d+){0,3})/g;
const EXACT = /^v?\d+(?:\.\d+){0,3}(?:-[\w.]+)?$/;
const HYPHEN = /^v?(\d+(?:\.\d+){0,3})\s+-\s+v?(\d+(?:\.\d+){0,3})$/;

const normalize = (range: string) => range.replace(/≥/g, ">=").replace(/≤/g, "<=").trim();

/** The comparisons in a range, or null when it has none Observator can read. */
export function parseRange(range: string): { op: Op; version: string }[] | null {
  const text = normalize(range);
  if (text === "*") return [{ op: ">=", version: "0" }];
  const hyphen = HYPHEN.exec(text);
  if (hyphen)
    return [
      { op: ">=", version: hyphen[1] },
      { op: "<=", version: hyphen[2] },
    ];
  const pairs = [...text.matchAll(PAIR)].map((m) => ({ op: m[1] as Op, version: m[2] }));
  return pairs.length ? pairs : null;
}

/** "1.2.3" or "2.0.0-beta.0, 2.0.0-beta.1": the exact versions a range lists, or null. */
function exactVersions(range: string): string[] | null {
  const parts = normalize(range)
    .split(/\s*,\s*/)
    .filter(Boolean);
  return parts.length && parts.every((p) => EXACT.test(p)) ? parts.map((p) => p.replace(/^v/, "")) : null;
}

/** Whether a version is in the range: true, false, or null when the range cannot be read. */
export function inRange(version: string, range: string): boolean | null {
  if (!/^\d+(\.\d+)*$/.test(version)) return null;
  const exact = exactVersions(range);
  if (exact) return exact.includes(version);
  const parts = parseRange(range);
  if (!parts) return null;
  return parts.every(({ op, version: bound }) => {
    const c = compareVersions(version, bound);
    return op === ">=" ? c >= 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : op === "<" ? c < 0 : c === 0;
  });
}

/** Whether a version is in the line of a patched one: all parts but the last equal (2.10.13 and 2.10.6). */
function sameLine(start: string, version: string): boolean {
  const a = start.split(".").map(Number);
  const b = version.split(".").map(Number);
  return a.slice(0, -1).every((n, i) => n === (b[i] ?? 0));
}

/**
 * Whether an advisory's patched versions include a version. A bare version is where the fixed
 * releases start: "2.10.6" is 2.10.6 and later. In a list such as "1.23.17, 2.0.1" each one starts
 * the fixed releases of its own line, and the highest of them every later release: 1.23.18 and
 * 3.0.0 are patched, 2.0.0 is not. A pre-release in the list ("2.0.0-beta.1") patches only itself,
 * so never a stable version, but it does end the line before it. A range (">= 0.20.0") is read as
 * a range. An empty or unreadable field patches nothing.
 */
export function isPatched(version: string, patched: string): boolean {
  if (!/^\d+(\.\d+)*$/.test(version)) return false;
  const listed = exactVersions(patched);
  if (!listed) return inRange(version, patched) === true;
  const start = listed
    .filter((p) => !p.includes("-") && compareVersions(p, version) <= 0)
    .sort(compareVersions)
    .pop();
  if (!start) return false;
  const highest = listed.every((p) => compareVersions(p.replace(/-.*$/, ""), start) <= 0);
  return highest || sameLine(start, version);
}

/** A range with no upper bound: "*", ">= 2.9.0" or "current (≥ 2.3.1, latest)". */
function openEnded(range: string): boolean {
  return parseRange(range)?.every(({ op }) => op === ">=" || op === ">") ?? false;
}

/**
 * What an advisory means for a version. GitHub usually gives an open-ended affected range next to
 * the first patched version (">= 2.9.0" and "2.10.6"): the patched version closes the range, so a
 * version it patches is "unaffected". A bounded range can contradict its own patched versions (an
 * affected range up to 1.19.0 next to "patched >= 0.20.0", a typo for 0.19.0): a version in both
 * "contradicts" and is not reported, but listed to check by hand.
 */
export type Verdict = "affected" | "unaffected" | "unclear" | "contradicts";

export function affects(version: string, vulnerable: string, patched: string): Verdict {
  const hit = inRange(version, vulnerable);
  if (hit === null) return "unclear";
  if (!hit) return "unaffected";
  if (!isPatched(version, patched)) return "affected";
  return openEnded(vulnerable) ? "unaffected" : "contradicts";
}

/** The lowest patched version above the running one, from "2.5.9" or "1.23.17, 2.0.1"; "" when none. */
export function fixedFor(version: string, patched: string): string {
  const candidates = patched
    .split(/[,;\s]+/)
    .map((p) => /^v?(\d+(?:\.\d+){0,3})$/.exec(p.trim())?.[1])
    .filter((p): p is string => Boolean(p) && compareVersions(p!, version) > 0)
    .sort(compareVersions);
  return candidates[0] ?? "";
}
