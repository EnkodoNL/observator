// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { env } from "@/lib/env";
import { kvGet, kvSet } from "@/lib/kv";
import { parseAdvisories, parseReleases, type Release, type RepoAdvisory } from "./repos";

/*
 * GitHub's REST API for public repositories: without a token 60 requests an hour, with
 * GITHUB_TOKEN 5000. Every answer is kept a day (an error an hour), so a few dozen repositories
 * stay well under either.
 */

const API = "https://api.github.com";
const HOUR = 3600 * 1000;
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

async function cached<T>(
  key: string,
  path: string,
  parse: (body: unknown) => T,
): Promise<T | { error: string }> {
  const hit = await kvGet<{ value: T } | { error: string }>(key);
  if (hit) return "error" in hit ? hit : hit.value;
  const token = env().GITHUB_TOKEN;
  try {
    const res = await fetch(`${API}${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "observator",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const limited =
      (res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0";
    if (!res.ok) {
      const error = limited
        ? `GitHub's rate limit${token ? "" : " (set GITHUB_TOKEN for more)"}`
        : res.status === 404
          ? "no such public repository"
          : `GitHub answered HTTP ${res.status}`;
      await kvSet(key, { error }, new Date(Date.now() + HOUR));
      return { error };
    }
    const value = parse(await res.json());
    await kvSet(key, { value }, new Date(Date.now() + 24 * HOUR));
    return value;
  } catch (err) {
    return {
      error: err instanceof Error && err.name === "TimeoutError" ? "GitHub timed out" : "GitHub unreachable",
    };
  }
}

/** A repository's stable releases, newest first. */
export function repoReleases(repo: string): Promise<Release[] | { error: string }> {
  if (!REPO.test(repo)) return Promise.resolve({ error: "not a repository" });
  return cached(`github:releases:${repo}`, `/repos/${repo}/releases?per_page=100`, parseReleases);
}

/** A repository's published security advisories. */
export function repoAdvisories(repo: string): Promise<RepoAdvisory[] | { error: string }> {
  if (!REPO.test(repo)) return Promise.resolve({ error: "not a repository" });
  return cached(
    `github:advisories:${repo}`,
    `/repos/${repo}/security-advisories?state=published&per_page=100`,
    parseAdvisories,
  );
}
