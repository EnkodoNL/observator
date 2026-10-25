// SPDX-License-Identifier: FSL-1.1-ALv2
import { parseNpmLock } from "./npm";
import { parsePnpmLock } from "./pnpm";
import { parseYarnBerry } from "./yarn-berry";
import { parseYarnV1 } from "./yarn-v1";
import { LockfileError, type PackageJson, type ParseResult } from "./types";

export { LockfileError } from "./types";
export type { Component, PackageJson, ParseResult } from "./types";

export const LOCKFILE_NAMES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"] as const;
export type LockfileName = (typeof LOCKFILE_NAMES)[number];

/**
 * Picks the lockfile to use when several are present: the `packageManager` field wins,
 * otherwise npm, then pnpm, then yarn.
 */
export function chooseLockfile(pkg: PackageJson, available: LockfileName[]): LockfileName | null {
  const manager = pkg.packageManager?.split("@")[0];
  const preferred: Record<string, LockfileName> = {
    npm: "package-lock.json",
    pnpm: "pnpm-lock.yaml",
    yarn: "yarn.lock",
  };
  if (manager && preferred[manager] && available.includes(preferred[manager])) return preferred[manager];
  return LOCKFILE_NAMES.find((n) => available.includes(n)) ?? null;
}

export function parsePackageJson(text: string): PackageJson {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as PackageJson;
  } catch {
    throw new LockfileError("package.json is not valid JSON");
  }
}

export function parseLockfile(name: LockfileName, text: string, pkg: PackageJson): ParseResult {
  switch (name) {
    case "package-lock.json":
      return parseNpmLock(text, pkg);
    case "pnpm-lock.yaml":
      return parsePnpmLock(text);
    case "yarn.lock":
      return /^__metadata:/m.test(text) ? parseYarnBerry(text, pkg) : parseYarnV1(text, pkg);
  }
}
