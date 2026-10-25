// SPDX-License-Identifier: FSL-1.1-ALv2
import semver from "semver";

/** Whether a package change between builds was an upgrade, a downgrade, or neither. */
export function changeDirection(from: string, to: string): "up" | "down" | "other" {
  const highest = (list: string) =>
    list
      .split(", ")
      .map((v) => semver.valid(v))
      .filter((v): v is string => Boolean(v))
      .sort(semver.rcompare)[0];
  const a = highest(from);
  const b = highest(to);
  if (!a || !b || a === b) return "other";
  return semver.gt(b, a) ? "up" : "down";
}
