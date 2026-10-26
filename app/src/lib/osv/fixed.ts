// SPDX-License-Identifier: FSL-1.1-ALv2
import semver from "semver";
import type { OsvQuery } from "./client";
import type { OsvVuln } from "./types";

const lt = (a: string, b: string) => semver.valid(a) && semver.valid(b) && semver.lt(a, b);
const lte = (a: string, b: string) => semver.valid(a) && semver.valid(b) && semver.lte(a, b);

/**
 * The first fixed version for this package and installed version: the "fixed" event that
 * closes the affected interval containing the version. Falls back to the smallest fix above
 * the installed version when the ranges are not semver.
 */
export function fixedIn(vuln: OsvVuln, { ecosystem, name, version }: OsvQuery): string {
  const candidates: string[] = [];
  const fallback: string[] = [];

  for (const affected of vuln.affected ?? []) {
    if (affected.package?.name !== name || affected.package.ecosystem !== ecosystem) continue;
    for (const range of affected.ranges ?? []) {
      let introduced: string | null = null;
      for (const event of range.events) {
        if (event.introduced !== undefined)
          introduced = event.introduced === "0" ? "0.0.0-0" : event.introduced;
        if (event.fixed !== undefined) {
          if (semver.valid(event.fixed) && lt(version, event.fixed)) fallback.push(event.fixed);
          if (introduced !== null && lte(introduced, version) && lt(version, event.fixed))
            candidates.push(event.fixed);
          introduced = null;
        }
        if (event.last_affected !== undefined) introduced = null;
      }
    }
  }
  const pick = (list: string[]) => list.sort(semver.compare)[0] ?? "";
  return pick(candidates) || pick(fallback);
}
