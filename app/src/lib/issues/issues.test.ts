// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import type { IgnoreRecord, IssueRecord } from "@/lib/pb/types";
import index from "@/lib/runtimes/node/__fixtures__/index.json";
import schedule from "@/lib/runtimes/node/__fixtures__/schedule.json";
import { compactIndex, type NodeData, nodeEvaluator } from "@/lib/runtimes/node/evaluate";
import { computeDesired, type DesiredInput, type VulnInput } from "./desired";
import { reconcile } from "./reconcile";

const now = new Date("2026-10-25T12:00:00Z");
const nodeData: NodeData = { releases: compactIndex(index), schedule, fetchedAt: "" };
const evaluateNode = nodeEvaluator(nodeData);

const lodashVuln: VulnInput = {
  ecosystem: "npm",
  name: "lodash",
  version: "4.17.20",
  osvId: "GHSA-35jh-r3h4-6jhm",
  aliases: ["CVE-2021-23337"],
  severity: "high",
  summary: "Command Injection in lodash",
  fixedIn: "4.17.21",
  url: "https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm",
};

function input(over: Partial<DesiredInput> = {}): DesiredInput {
  return {
    build: { runtimes: [{ name: "node", version: "22.11.0" }], os: "alpine" },
    lastBuildAt: now,
    components: [
      { ecosystem: "npm", name: "lodash", version: "4.17.20", direct: true, dev: false, via: [] },
      { ecosystem: "npm", name: "ms", version: "2.0.0", direct: false, dev: false, via: ["express"] },
    ],
    vulns: [lodashVuln],
    evaluations: [evaluateNode("22.11.0", now)],
    staleDays: 14,
    now,
    ...over,
  };
}

let seq = 0;
function stored(fields: Partial<IssueRecord>): IssueRecord {
  return {
    id: `i${++seq}`,
    created: "",
    updated: "",
    project: "p1",
    kind: "vuln",
    key: "",
    revision: "",
    severity: "high",
    title: "",
    data: {},
    status: "open",
    firstSeen: "",
    lastSeen: "",
    resolvedAt: "",
    notifiedAt: "",
    ...fields,
  };
}

function ignore(fields: Partial<IgnoreRecord>): IgnoreRecord {
  return {
    id: "ig",
    created: "",
    updated: "",
    project: "",
    osvId: "",
    package: "",
    reason: "accepted",
    expiresAt: "",
    createdBy: "",
    ...fields,
  };
}

describe("computeDesired", () => {
  it("derives runtime and package issues", () => {
    const issues = computeDesired(input());
    expect(issues.map((i) => [i.key, i.revision, i.severity])).toEqual([
      ["runtime_security:node:22", "22.23.4", "high"],
      ["vuln:GHSA-35jh-r3h4-6jhm:lodash", "", "high"],
    ]);
    expect(issues[0].title).toBe("Node.js 22.11.0 has a security update: 22.23.4");
    expect(issues[0].data).toEqual({
      runtime: "node",
      running: "22.11.0",
      target: "22.23.4",
      line: "22",
      securityReleases: expect.arrayContaining(["22.23.4"]),
      os: "alpine",
    });
    expect(issues[1].data).toMatchObject({
      ecosystem: "npm",
      package: "lodash",
      version: "4.17.20",
      fixedIn: "4.17.21",
      direct: true,
    });
  });

  it("ignores advisories for versions that are not installed", () => {
    const issues = computeDesired(input({ vulns: [{ ...lodashVuln, version: "4.17.11" }] }));
    expect(issues.some((i) => i.kind === "vuln")).toBe(false);
  });

  it("makes one issue of a Go advisory and its GHSA, rated by the GHSA", () => {
    const go = { ecosystem: "Go", name: "golang.org/x/net", version: "v0.20.0", fixedIn: "0.23.0", url: "" };
    const issues = computeDesired(
      input({
        components: [{ ...go, direct: false, dev: false, via: [] }],
        vulns: [
          {
            ...go,
            osvId: "GO-2024-2687",
            aliases: ["CVE-2023-45288", "GHSA-4v7x-pqxf-cx7m"],
            severity: "unknown",
            summary: "HTTP/2 CONTINUATION flood in net/http",
          },
          {
            ...go,
            osvId: "GHSA-4v7x-pqxf-cx7m",
            aliases: ["CVE-2023-45288", "GO-2024-2687"],
            severity: "moderate",
            summary: "net/http, x/net/http2: close connections when receiving too many headers",
          },
          { ...go, osvId: "GO-2026-0001", aliases: [], severity: "unknown", summary: "Unrated" },
        ],
      }),
    ).filter((i) => i.kind === "vuln");
    expect(issues.map((i) => [i.key, i.severity])).toEqual([
      ["vuln:GHSA-4v7x-pqxf-cx7m:golang.org/x/net", "moderate"],
      ["vuln:GO-2026-0001:golang.org/x/net", "unknown"],
    ]);
    expect(issues[0].data).toMatchObject({
      aliases: ["CVE-2023-45288", "GO-2024-2687"],
      // go get needs the v that OSV leaves off.
      fixedIn: "v0.23.0",
    });
  });

  it("matches advisories within their own ecosystem", () => {
    const issues = computeDesired(input({ vulns: [{ ...lodashVuln, ecosystem: "PyPI" }] }));
    expect(issues.some((i) => i.kind === "vuln")).toBe(false);
  });

  it("adds end-of-life and stale issues", () => {
    const issues = computeDesired(
      input({
        build: { runtimes: [{ name: "node", version: "20.18.0" }], os: "debian" },
        evaluations: [evaluateNode("20.18.0", now)],
        lastBuildAt: new Date("2026-09-01T00:00:00Z"),
        vulns: [],
      }),
    );
    expect(issues.map((i) => i.key)).toEqual(["runtime_security:node:20", "runtime_eol:node:20", "stale"]);
    expect(issues.find((i) => i.kind === "stale")?.title).toBe("No new build for 54 days");
  });

  it("lets Coolify decide: no deploy since is fine, a deploy without a report is news", () => {
    const old = { lastBuildAt: new Date("2026-09-01T00:00:00Z"), vulns: [] };
    const stale = (deploy: Parameters<typeof computeDesired>[0]["deploy"]) =>
      computeDesired(input({ ...old, deploy })).find((i) => i.kind === "stale");
    // Without Coolify: the age rule.
    expect(stale(undefined)).toMatchObject({ severity: "low", data: { reason: "age", days: 54 } });
    // Coolify checked and nothing was deployed since: however old, nothing to say.
    expect(stale({ unreported: null })).toBeUndefined();
    // A deploy without a report, announced as such, with the deployment as revision.
    expect(
      stale({ unreported: { at: "2026-10-20T10:00:00Z", commit: "abc1234def", uuid: "dep-1" } }),
    ).toMatchObject({
      severity: "moderate",
      revision: "dep-1",
      title: "Deployed without a report on 2026-10-20",
      data: { reason: "deploy", deploy: { at: "2026-10-20T10:00:00Z", commit: "abc1234def" } },
    });
  });
});

describe("reconcile", () => {
  it("opens new issues with one event each", () => {
    const r = reconcile("p1", [], computeDesired(input()), [], now);
    expect(r.creates).toHaveLength(2);
    expect(r.events.map((e) => e.type)).toEqual(["runtime.security_update", "vuln.new"]);
  });

  it("stays quiet when nothing changed", () => {
    const desired = computeDesired(input());
    const existing = desired.map((d) =>
      stored({ ...d, data: d.data as unknown as Record<string, unknown>, status: "open" }),
    );
    const r = reconcile("p1", existing, desired, [], now);
    expect(r.events).toEqual([]);
    expect(r.creates).toEqual([]);
    expect(r.updates.every((u) => u.patch.status === "open")).toBe(true);
  });

  it("notifies again when a newer runtime security release changes the target", () => {
    const desired = computeDesired(input());
    const existing = [
      stored({
        kind: "runtime_security",
        key: "runtime_security:node:22",
        revision: "22.20.0",
        status: "open",
      }),
    ];
    const r = reconcile("p1", existing, desired.slice(0, 1), [], now);
    expect(r.events.map((e) => [e.type, e.revision])).toEqual([["runtime.security_update", "22.23.4"]]);
  });

  it("resolves issues that disappeared, and only announces notified vulnerabilities", () => {
    const existing = [
      stored({ key: "vuln:A:x", notifiedAt: "2026-10-01 00:00:00.000Z" }),
      stored({ key: "vuln:B:y" }),
      stored({
        kind: "runtime_security",
        key: "runtime_security:node:22",
        notifiedAt: "2026-10-01 00:00:00.000Z",
      }),
      stored({ key: "vuln:C:z", status: "ignored", notifiedAt: "2026-10-01 00:00:00.000Z" }),
    ];
    const r = reconcile("p1", existing, [], [], now);
    expect(r.updates.map((u) => u.patch.status)).toEqual(["resolved", "resolved", "resolved", "resolved"]);
    expect(r.events.map((e) => [e.type, e.key])).toEqual([["vuln.resolved", "vuln:A:x"]]);
  });

  it("reopens resolved issues as new", () => {
    const desired = computeDesired(input({ evaluations: [] }));
    const existing = [stored({ key: "vuln:GHSA-35jh-r3h4-6jhm:lodash", status: "resolved" })];
    const r = reconcile("p1", existing, desired, [], now);
    expect(r.events.map((e) => e.type)).toEqual(["vuln.new"]);
    expect(r.updates[0].patch).toMatchObject({ status: "open", resolvedAt: null });
  });

  it("applies ignores by advisory, alias or package, and respects expiry", () => {
    const desired = computeDesired(input({ evaluations: [] }));
    for (const ig of [
      ignore({ osvId: "GHSA-35jh-r3h4-6jhm" }),
      ignore({ osvId: "cve-2021-23337" }),
      ignore({ package: "lodash", project: "p1" }),
    ]) {
      const r = reconcile("p1", [], desired, [ig], now);
      expect(r.creates[0].status).toBe("ignored");
      expect(r.events).toEqual([]);
    }
    expect(
      reconcile("p1", [], desired, [ignore({ package: "lodash", project: "p2" })], now).creates[0].status,
    ).toBe("open");
    const expired = ignore({ package: "lodash", expiresAt: "2026-10-01 00:00:00.000Z" });
    expect(reconcile("p1", [], desired, [expired], now).creates[0].status).toBe("open");
  });

  it("announces an issue once its ignore is lifted", () => {
    const desired = computeDesired(input({ evaluations: [] }));
    const existing = [stored({ key: "vuln:GHSA-35jh-r3h4-6jhm:lodash", status: "ignored" })];
    const r = reconcile("p1", existing, desired, [], now);
    expect(r.events.map((e) => e.type)).toEqual(["vuln.new"]);
  });
});
