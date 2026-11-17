// SPDX-License-Identifier: FSL-1.1-ALv2
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeImage } from "@/lib/images/describe";
import { parseImageRef } from "@/lib/images/reference";
import type { ProjectRecord } from "@/lib/pb/types";

// PocketBase, kv, Coolify and the registry in memory; neutral, made-up names and uuids only.
const projects: (Partial<ProjectRecord> & { id: string })[] = [];
const kv = new Map<string, unknown>();
const builds = new Map<string, { runtimes: { name: string; version: string }[]; lockfileHash: string }>();
const vulns: Record<string, unknown>[] = [];

const projectStore = {
  getFullList: async () => projects.filter((p) => p.coolifyKind).map((p) => ({ ...p })),
  create: async (data: Partial<ProjectRecord>) => {
    const p = { id: `p${projects.length + 1}`, coolifyGoneAt: "", ...data };
    projects.push(p);
    return { ...p };
  },
  update: async (id: string, data: Partial<ProjectRecord>) => {
    const p = projects.find((x) => x.id === id)!;
    Object.assign(p, data);
    return { ...p };
  },
};
let vulnId = 0;
const vulnStore = {
  getFullList: async () => vulns.map((v) => ({ ...v })),
  create: async (data: Record<string, unknown>) => void vulns.push({ id: `v${++vulnId}`, ...data }),
  update: async (id: string, data: Record<string, unknown>) =>
    void Object.assign(vulns.find((v) => v.id === id) ?? {}, data),
  delete: async (id: string) =>
    void vulns.splice(
      vulns.findIndex((v) => v.id === id),
      1,
    ),
};
vi.mock("@/lib/pb/admin", () => ({
  toPbDate: (d: Date) => d.toISOString().replace("T", " "),
  adminPb: async () => ({
    collection: (name: string) => (name === "vulnerabilities" ? vulnStore : projectStore),
    filter: (q: string) => q,
  }),
}));
vi.mock("@/lib/kv", () => ({
  kvGet: async (key: string) => kv.get(key) ?? null,
  kvSet: async (key: string, value: unknown) => void kv.set(key, value),
}));
vi.mock("@/lib/data/projects", () => ({ uniqueSlug: async (base: string) => base }));
vi.mock("./servers", () => ({
  listServers: async () => [{ id: "srv1", name: "lab", url: "https://coolify.example.com", token: "x" }],
  serverAccess: () => ({ base: "https://coolify.example.com", token: "t" }),
}));
const listDatabases = vi.fn();
const listServices = vi.fn();
const serviceImages = vi.fn();
const resourceScan = vi.fn();
vi.mock("./client", () => ({
  listDatabases: () => listDatabases(),
  listServices: () => listServices(),
  serviceImages: () => serviceImages(),
  resourceScan: (_access: unknown, kind: string) => resourceScan(kind),
}));
const repoReleases = vi.fn();
const repoAdvisories = vi.fn();
vi.mock("@/lib/github/client", () => ({
  repoReleases: (repo: string) => repoReleases(repo),
  repoAdvisories: (repo: string) => repoAdvisories(repo),
}));
// What the registry says per image; a missing one is an outage.
const registry = new Map<string, Record<string, string>>();
vi.mock("@/lib/images/inspect", () => ({
  inspectImage: async (raw: string) => {
    const env = registry.get(raw);
    return describeImage(parseImageRef(raw)!, env ? { env, labels: {} } : null, env ? null : "unreachable");
  },
}));
type Files = { components?: { ecosystem?: string; name: string; version: string }[] };
const recordBuild = vi.fn(async (project: { id: string }, files: Files, meta: { runtimes: never[] }) => {
  builds.set(project.id, { runtimes: meta.runtimes, lockfileHash: JSON.stringify(files.components ?? []) });
  return {};
});
vi.mock("@/lib/ingest/ingest", () => ({
  latestBuild: async (id: string) => builds.get(id) ?? null,
  recordBuild: (p: { id: string }, f: Files, m: { runtimes: never[] }) => recordBuild(p, f, m),
  reportHash: (...args: unknown[]) => JSON.stringify(args[4] ?? []),
}));
vi.mock("@/lib/ingest/analyze", () => ({
  analyzeInline: async () => ({}),
  analyzeInBackground: async () => [],
}));
const evaluateProject = vi.fn<(id: string) => Promise<never[]>>(async () => []);
vi.mock("@/lib/issues/evaluate", () => ({ evaluateProject: (id: string) => evaluateProject(id) }));
vi.mock("@/lib/notify/publish", () => ({ publish: async () => {} }));

const { resourceRuntimes, syncCoolifyResources } = await import("./resources");

const DB = "d1aaaaaaaaaaaaaaaaaaaaaa";
const SVC = "s1aaaaaaaaaaaaaaaaaaaaaa";

beforeEach(() => {
  projects.length = 0;
  kv.clear();
  builds.clear();
  registry.clear();
  vulns.length = 0;
  recordBuild.mockClear();
  resourceScan.mockReset().mockResolvedValue({ findings: [], off: null, scannedAt: null });
  repoReleases.mockReset().mockResolvedValue([]);
  repoAdvisories.mockReset().mockResolvedValue([]);
  evaluateProject.mockClear();
  registry.set("mariadb:11", { MARIADB_VERSION: "1:11.8.9+maria~ubu2404" });
  registry.set("ghcr.io/acme/web-app:2", { NODE_VERSION: "22.23.4" });
  registry.set("postgres:16.4-alpine", { PG_VERSION: "16.4" });
  listDatabases.mockResolvedValue([{ uuid: DB, name: "shop-db", kind: "mariadb", image: "mariadb:11" }]);
  listServices.mockResolvedValue([{ uuid: SVC, name: "stats", type: "analytics" }]);
  serviceImages.mockResolvedValue([
    { name: "web", image: "ghcr.io/acme/web-app:2" },
    { name: "db", image: "postgres:16.4-alpine" },
  ]);
});

describe("syncCoolifyResources", () => {
  it("makes a project per database and service and records what their images run", async () => {
    await syncCoolifyResources();
    expect(projects.map((p) => [p.name, p.coolifyKind, p.apiKeyPrefix, p.coolifyUuid])).toEqual([
      ["shop-db", "database", "coolify", DB],
      ["stats", "service", "coolify", SVC],
    ]);
    // A moving tag records only the line; a pinned one its exact version.
    expect(recordBuild.mock.calls.map((c) => c[2].runtimes)).toEqual([
      [{ name: "mariadb", version: "11.8" }],
      [
        { name: "node", version: "22.23.4" },
        { name: "postgresql", version: "16.4" },
      ],
    ]);
    expect(recordBuild.mock.calls[0][2]).toMatchObject({ labels: { labels: ["coolify:database"] } });
    expect(kv.get("coolify:sync:srv1")).toMatchObject({ databases: 1, services: 1, error: null });
  });

  it("records nothing new when nothing changed, also when the registry is down", async () => {
    await syncCoolifyResources();
    recordBuild.mockClear();
    await syncCoolifyResources();
    expect(recordBuild).not.toHaveBeenCalled();
    registry.clear();
    await syncCoolifyResources();
    expect(recordBuild).not.toHaveBeenCalled();
    const inventory = kv.get("coolify:resource:p1") as { images: { versionNow: string; error: string }[] };
    expect(inventory.images[0]).toMatchObject({ versionNow: "11.8.9", error: "unreachable" });
  });

  it("marks a resource gone only after a listing that worked", async () => {
    await syncCoolifyResources();
    listDatabases.mockResolvedValue({ error: "Coolify unreachable" });
    await syncCoolifyResources();
    expect(projects[0].coolifyGoneAt).toBe("");
    expect(kv.get("coolify:sync:srv1")).toMatchObject({ databases: null, error: "Coolify unreachable" });

    listDatabases.mockResolvedValue([]);
    await syncCoolifyResources();
    expect(projects[0].coolifyGoneAt).not.toBe("");
    expect(evaluateProject).toHaveBeenCalledWith("p1");
    expect(projects[1].coolifyGoneAt).toBe("");
  });
});

describe("Coolify's scan and apps on GitHub", () => {
  const finding = (fields: Record<string, unknown>) => ({
    id: "CVE-2026-0001",
    aliases: [],
    title: "Heap overflow in a parser",
    severity: "high",
    package: "libexample",
    version: "1.0.1",
    type: "deb",
    fixedIn: "1.0.2",
    kev: false,
    url: "https://example.com/advisory",
    ignored: false,
    ...fields,
  });

  it("makes fixable findings advisories, and only counts the rest", async () => {
    resourceScan.mockImplementation(async (kind: string) =>
      kind === "database"
        ? {
            findings: [
              finding({ kev: true }),
              finding({ id: "CVE-2026-0002", package: "libother", fixedIn: "" }),
              finding({ id: "CVE-2026-0003", package: "libignored", ignored: true }),
            ],
            off: null,
            scannedAt: "2026-11-17T10:00:00Z",
          }
        : { findings: [], off: "image scanning is off", scannedAt: null },
    );
    await syncCoolifyResources();
    const db = recordBuild.mock.calls[0][1].components;
    expect(db).toEqual([
      { name: "libexample", version: "1.0.1", direct: false, dev: false, via: [], ecosystem: "coolify:deb" },
    ]);
    expect(vulns).toMatchObject([
      {
        ecosystem: "coolify:deb",
        name: "libexample",
        osvId: "CVE-2026-0001",
        severity: "high",
        fixedIn: "1.0.2",
      },
    ]);
    expect(String(vulns[0].summary)).toMatch(/^Known to be exploited/);
    expect(kv.get("coolify:resource:p1")).toMatchObject({ scan: { fixable: 1, unfixable: 1, error: null } });
    expect(kv.get("coolify:resource:p2")).toMatchObject({ scan: { off: "image scanning is off" } });
  });

  it("drops a finding's advisory only after a sync that read every scan", async () => {
    resourceScan.mockResolvedValue({ findings: [finding({})], off: null, scannedAt: null });
    await syncCoolifyResources();
    expect(vulns).toHaveLength(1);
    resourceScan.mockResolvedValue({ error: "Coolify timed out" });
    await syncCoolifyResources();
    expect(vulns).toHaveLength(1);
    resourceScan.mockResolvedValue({ findings: [], off: null, scannedAt: null });
    await syncCoolifyResources();
    expect(vulns).toHaveLength(0);
  });

  it("checks an app by its repository, a moving tag as the newest release in its line", async () => {
    repoReleases.mockResolvedValue([
      { version: "3.0.0", tag: "v3.0.0", published: "" },
      { version: "2.4.1", tag: "v2.4.1", published: "" },
      { version: "2.3.0", tag: "v2.3.0", published: "" },
    ]);
    repoAdvisories.mockResolvedValue([
      { id: "GHSA-aaaa-bbbb-cccc", vulnerable: "current (>= 2.3.1, latest)", patched: "" },
      { id: "GHSA-dddd-eeee-ffff", vulnerable: "all versions before the rewrite", patched: "" },
    ]);
    await syncCoolifyResources();
    const service = recordBuild.mock.calls[1][1].components;
    expect(service).toContainEqual({
      name: "acme/web-app",
      version: "2.4.1",
      direct: true,
      dev: false,
      via: [],
      ecosystem: "GitHub",
    });
    expect(kv.get("coolify:resource:p2")).toMatchObject({
      apps: [
        {
          source: "acme/web-app",
          version: "2.4.1",
          assumed: true,
          latest: "3.0.0",
          unclear: ["GHSA-dddd-eeee-ffff"],
        },
      ],
    });
  });
});

describe("resourceRuntimes", () => {
  it("lists each product and runtime once", () => {
    const image = describeImage(parseImageRef("postgres:16.4")!, { env: { PG_VERSION: "16.4" }, labels: {} });
    expect(resourceRuntimes([image, image])).toEqual([{ name: "postgresql", version: "16.4" }]);
  });
});
