// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import semver from "semver";
import { kvGet, kvSet } from "@/lib/kv";
import { adminPb } from "@/lib/pb/admin";

const KEY = "npm:latest";
const MAX_AGE_MS = 24 * 3600 * 1000;

type Latest = Record<string, { version: string; at: number }>;

export type Outdated = "major" | "minor" | "patch" | null;

/** How far behind the installed version is; null when current, newer or not comparable. */
export function outdatedLevel(installed: string, latest: string | undefined): Outdated {
  if (!latest || !semver.valid(installed) || !semver.valid(latest) || !semver.lt(installed, latest))
    return null;
  const diff = semver.diff(installed, latest);
  if (diff === "major" || diff === "premajor") return "major";
  if (diff === "minor" || diff === "preminor") return "minor";
  return "patch";
}

export async function latestVersions(): Promise<Record<string, string>> {
  const stored = (await kvGet<Latest>(KEY)) ?? {};
  return Object.fromEntries(Object.entries(stored).map(([name, v]) => [name, v.version]));
}

async function fetchLatest(name: string): Promise<string | null> {
  const path = name.startsWith("@") ? name.replace("/", "%2f") : name;
  const res = await fetch(`https://registry.npmjs.org/${path}/latest`, {
    headers: { accept: "application/json", "user-agent": "observator" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { version?: string };
  return typeof data.version === "string" ? data.version : null;
}

/**
 * Refreshes the latest-version cache for the given package names (or for every direct
 * dependency in use). Only entries older than a day are fetched again.
 */
export async function refreshLatest(names?: string[]): Promise<number> {
  if (!names) {
    const pb = await adminPb();
    const direct = await pb
      .collection("components")
      .getFullList<{ name: string }>({ filter: "direct = true", fields: "name" });
    names = direct.map((d) => d.name);
  }
  const stored = (await kvGet<Latest>(KEY)) ?? {};
  const now = Date.now();
  const due = [...new Set(names)].filter((n) => !stored[n] || now - stored[n].at > MAX_AGE_MS);
  let fetched = 0;
  for (let i = 0; i < due.length; i += 6) {
    const batch = due.slice(i, i + 6);
    const results = await Promise.all(batch.map((n) => fetchLatest(n).catch(() => null)));
    batch.forEach((name, j) => {
      if (results[j]) {
        stored[name] = { version: results[j]!, at: now };
        fetched++;
      }
    });
  }
  if (fetched) await kvSet(KEY, stored);
  return fetched;
}
