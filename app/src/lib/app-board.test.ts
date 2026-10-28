// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "@/lib/data/views";
import type { BuildRecord, IssueRecord, ProjectRecord, Severity } from "@/lib/pb/types";
import { appBoard, findApp } from "./app-board";
import { summarize } from "./status";

const vuln = (severity: Severity, dev = false) =>
  ({
    kind: "vuln",
    severity,
    status: "open",
    data: { package: "x", version: "1", dev },
  }) as unknown as IssueRecord;

function item(
  name: string,
  { labels = [] as string[], issues = [] as IssueRecord[], sourceName = "", instance = "" } = {},
): ProjectSummary {
  return {
    project: { name, slug: name, labels, sourceName, instance } as unknown as ProjectRecord,
    latest: { runtimes: [] } as unknown as BuildRecord,
    summary: summarize(true, issues),
    lastBuildAt: new Date(),
  };
}

describe("appBoard", () => {
  it("groups by app label and names services by role, apps that need work first", () => {
    const apps = appBoard(
      [
        item("gelukscode-site · 1.2.3.4", { sourceName: "gelukscode-site", instance: "1.2.3.4" }),
        item("tuinsnap-cms", { labels: ["app:tuinsnap", "role:cms"], issues: [vuln("low", true)] }),
        item("tuinsnap-backend", { labels: ["app:tuinsnap", "role:backend"], issues: [vuln("moderate")] }),
      ],
      14,
    );
    expect(apps.map((a) => a.name)).toEqual(["tuinsnap", "gelukscode-site"]);
    expect(apps[0]).toMatchObject({
      needsWork: true,
      advisories: 1,
      buildOnly: 1,
      worstSeverity: "moderate",
    });
    expect(apps[0].services.map((s) => s.name)).toEqual(["backend", "cms"]);
    expect(apps[1]).toMatchObject({ needsWork: false, services: [{ name: "gelukscode-site" }] });
  });

  it("puts a shared key's servers under one service and counts their advisories once", () => {
    const servers = ["10.0.0.1", "10.0.0.2"].map((ip) =>
      item(`penal-api · ${ip}`, {
        labels: ["app:penal", "role:api"],
        sourceName: "penal-api",
        instance: ip,
        issues: [vuln("moderate"), vuln("moderate")],
      }),
    );
    const [app] = appBoard(servers, 14);
    expect(app.services).toHaveLength(1);
    expect(app.services[0]).toMatchObject({ name: "api", advisories: 2 });
    expect(app.services[0].servers).toHaveLength(2);
    expect(app.advisories).toBe(2);
  });

  it("strips the app name from services without a role", () => {
    const [app] = appBoard([item("cinnux-socket", { labels: ["app:cinnux"] })], 14);
    expect(app.services[0].name).toBe("socket");
  });

  it("sums the services' advisories by severity", () => {
    const [app] = appBoard(
      [
        item("shop-web", { labels: ["app:shop"], issues: [vuln("high"), vuln("moderate")] }),
        item("shop-worker", { labels: ["app:shop"], issues: [vuln("moderate"), vuln("low", true)] }),
      ],
      14,
    );
    expect(app.counts).toEqual({ high: 1, moderate: 2 });
  });
});

describe("findApp", () => {
  it("addresses an app by its label, or by the reported name as a slug", () => {
    const apps = appBoard(
      [
        item("Sip Helper · 10.0.0.1", { sourceName: "Sip Helper", instance: "10.0.0.1" }),
        item("tuinsnap-cms", { labels: ["app:tuinsnap"] }),
      ],
      14,
    );
    expect(findApp(apps, "sip-helper")?.name).toBe("Sip Helper");
    expect(findApp(apps, "tuinsnap")?.name).toBe("tuinsnap");
    expect(findApp(apps, "nope")).toBeUndefined();
  });

  it("prefers the app label when a project without one has the same name", () => {
    const apps = appBoard([item("penal"), item("penal-api", { labels: ["app:penal"] })], 14);
    expect(apps.map((a) => a.id)).toEqual(["penal", "penal"]);
    expect(findApp(apps, "penal")?.key).toBe("label:penal");
  });
});
