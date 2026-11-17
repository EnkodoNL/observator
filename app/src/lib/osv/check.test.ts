// SPDX-License-Identifier: FSL-1.1-ALv2
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OsvVuln } from "./types";

// The vulnerabilities cache in memory, and OSV as stubs.
const rows: Record<string, unknown>[] = [];
vi.mock("@/lib/pb/admin", () => ({
  toPbDate: (d: Date) => d.toISOString().replace("T", " "),
  adminPb: async () => ({
    filter: (q: string) => q,
    collection: () => ({
      getFullList: async () => rows.map((r) => ({ ...r })),
      create: async (data: Record<string, unknown>) => void rows.push({ id: `r${rows.length}`, ...data }),
      update: async (id: string, data: Record<string, unknown>) =>
        void Object.assign(rows.find((r) => r.id === id) ?? {}, data),
      delete: async (id: string) =>
        void rows.splice(
          rows.findIndex((r) => r.id === id),
          1,
        ),
    }),
  }),
}));
const queryBatch = vi.fn<(queries: { name: string }[]) => Promise<{ id: string; modified: string }[][]>>();
const getVuln = vi.fn<(id: string) => Promise<OsvVuln>>();
vi.mock("./client", () => ({
  queryBatch: (q: { name: string }[]) => queryBatch(q),
  getVuln: (id: string) => getVuln(id),
  osvUrl: (id: string) => `https://osv.dev/vulnerability/${id}`,
}));

const repoAdvisories = vi.fn();
vi.mock("@/lib/github/client", () => ({ repoAdvisories: (repo: string) => repoAdvisories(repo) }));

const { checkPackages } = await import("./check");

const OLD = "github.com/pocketbase/pocketbase";
const NEW = "ganigeorgiev.com/pocketbase/pocketbase";
const advisory: OsvVuln = {
  id: "GHSA-aaaa-bbbb-cccc",
  modified: "2026-10-07T00:00:00Z",
  summary: "Unhandled panic in worker goroutines",
  aliases: ["GO-2026-0001"],
  affected: [
    {
      package: { ecosystem: "Go", name: OLD },
      ranges: [{ type: "SEMVER", events: [{ introduced: "0.23.0" }, { fixed: "0.39.7" }] }],
    },
  ],
} as OsvVuln;

beforeEach(() => {
  rows.length = 0;
  queryBatch.mockReset();
  getVuln.mockReset().mockResolvedValue(advisory);
});

describe("checkPackages and a moved Go module", () => {
  const pocketbase = { ecosystem: "Go", name: NEW, version: "v0.39.0" };

  it("asks OSV under the old path too and keeps the advisory under the component's name", async () => {
    // OSV knows only the old path: nothing for the new one.
    queryBatch.mockImplementation(async (q) =>
      q.map((x) => (x.name === OLD ? [{ id: advisory.id, modified: advisory.modified! }] : [])),
    );
    expect(await checkPackages([pocketbase])).toEqual({ checked: 1, vulnerable: 1 });
    expect(queryBatch.mock.calls[0][0].map((x) => x.name)).toEqual([NEW, OLD]);
    expect(rows).toMatchObject([{ name: NEW, version: "v0.39.0", osvId: advisory.id, fixedIn: "0.39.7" }]);

    // The next check keeps it, and drops it once OSV no longer lists it.
    await checkPackages([pocketbase]);
    expect(rows).toHaveLength(1);
    queryBatch.mockImplementation(async (q) => q.map(() => []));
    await checkPackages([pocketbase]);
    expect(rows).toHaveLength(0);
  });

  it("counts a record OSV returns under both names once", async () => {
    queryBatch.mockImplementation(async (q) =>
      q.map(() => [{ id: advisory.id, modified: advisory.modified! }]),
    );
    await checkPackages([pocketbase]);
    expect(rows).toHaveLength(1);
  });

  it("asks only once for other modules", async () => {
    queryBatch.mockImplementation(async (q) => q.map(() => []));
    await checkPackages([{ ecosystem: "Go", name: "golang.org/x/net", version: "v0.20.0" }]);
    expect(queryBatch.mock.calls[0][0].map((x) => x.name)).toEqual(["golang.org/x/net"]);
  });
});

describe("checkPackages for apps and Coolify's scan", () => {
  const app = { ecosystem: "GitHub", name: "example/app", version: "2.4.0" };

  it("checks an app against its repository's advisories, and never asks OSV about it", async () => {
    queryBatch.mockImplementation(async (q) => q.map(() => []));
    repoAdvisories.mockResolvedValue([
      {
        id: "GHSA-aaaa-bbbb-cccc",
        cve: "CVE-2026-0001",
        severity: "high",
        summary: "Injection",
        url: "https://github.com/example/app/security/advisories/GHSA-aaaa-bbbb-cccc",
        vulnerable: ">= 2.1.0, <= 2.5.8",
        patched: "2.5.9",
        updated: "2026-11-01T00:00:00Z",
      },
      {
        id: "GHSA-dddd-eeee-ffff",
        cve: null,
        severity: "low",
        summary: "",
        url: "",
        vulnerable: "< 2.0.0",
        patched: "2.0.0",
        updated: "",
      },
      {
        id: "GHSA-gggg-hhhh-iiii",
        cve: null,
        severity: "low",
        summary: "",
        url: "",
        vulnerable: "some old versions",
        patched: "",
        updated: "",
      },
    ]);
    const result = await checkPackages([
      app,
      { ecosystem: "coolify:deb", name: "libexample", version: "1.0.1" },
      { ecosystem: "npm", name: "left-pad", version: "1.3.0" },
    ]);
    expect(queryBatch.mock.calls[0][0].map((x) => x.name)).toEqual(["left-pad"]);
    expect(rows).toMatchObject([
      {
        ecosystem: "GitHub",
        name: "example/app",
        osvId: "GHSA-aaaa-bbbb-cccc",
        aliases: ["CVE-2026-0001"],
        severity: "high",
        fixedIn: "2.5.9",
      },
    ]);
    expect(result).toEqual({ checked: 2, vulnerable: 1 });

    // Fixed upstream and taken: the row goes; an unreadable repository leaves rows alone.
    repoAdvisories.mockResolvedValue({ error: "GitHub unreachable" });
    await checkPackages([app]);
    expect(rows).toHaveLength(1);
    repoAdvisories.mockResolvedValue([]);
    await checkPackages([app]);
    expect(rows).toHaveLength(0);
  });
});
