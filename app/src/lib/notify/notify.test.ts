// SPDX-License-Identifier: FSL-1.1-ALv2
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IssueEvent } from "@/lib/issues/events";
import { describeFetchError, request } from "./channels/types";
import { signWebhook } from "./channels/webhook";
import { toMarkdown, toPlainText } from "./message";
import { renderEvents, type RenderContext } from "./render";

const ctx: RenderContext = {
  appUrl: "https://obs.example.com",
  projects: new Map([
    ["p1", { name: "api", slug: "api", canRedeploy: true }],
    ["p2", { name: "worker", slug: "worker", canRedeploy: false }],
  ]),
};

const vuln = (projectId: string, pkg: string, severity: IssueEvent["severity"]): IssueEvent => ({
  type: "vuln.new",
  projectId,
  kind: "vuln",
  key: `vuln:X:${pkg}`,
  revision: "",
  severity,
  title: pkg,
  occurredAt: "2026-10-25T00:00:00.000Z",
  data: {
    package: pkg,
    version: "1.0.0",
    osvId: "GHSA-x",
    aliases: [],
    summary: "Bad",
    fixedIn: "1.0.1",
    url: "https://osv.dev/x",
    direct: true,
    dev: false,
    via: [],
  },
});

describe("renderEvents", () => {
  it("bundles advisories of one build into one message, worst first", () => {
    const msg = renderEvents(
      "vuln.new",
      [vuln("p1", "a", "low"), vuln("p1", "b", "critical"), vuln("p1", "c", "high")],
      ctx,
    );
    expect(msg.title).toBe("3 new vulnerabilities in api");
    expect(msg.tone).toBe("critical");
    expect(msg.items.map((i) => i.title)).toEqual(["b@1.0.0", "c@1.0.0", "a@1.0.0"]);
    expect(msg.actions.map((a) => a.label)).toEqual(["Open project", "Redeploy"]);
    expect(msg.actions[1].url).toBe("https://obs.example.com/projects/api?redeploy=1");
  });

  it("caps long lists", () => {
    const events = Array.from({ length: 14 }, (_, i) => vuln("p1", `pkg${i}`, "moderate"));
    const msg = renderEvents("vuln.new", events, ctx);
    expect(msg.items).toHaveLength(10);
    expect(msg.more).toBe(4);
    expect(toPlainText(msg)).toContain("...and 4 more");
  });

  it("groups one Node security release across projects", () => {
    const node = (projectId: string): IssueEvent => ({
      type: "node.security_update",
      projectId,
      kind: "node_security",
      key: "node_security:22",
      revision: "22.23.4",
      severity: "high",
      title: "",
      occurredAt: "2026-10-25T00:00:00.000Z",
      data: { running: "22.11.0", target: "22.23.4", major: 22, securityReleases: ["22.23.4"], os: "alpine" },
    });
    const msg = renderEvents("node.security_update", [node("p1"), node("p2")], ctx);
    expect(msg.title).toBe("Node security update for 2 projects");
    expect(msg.items.map((i) => i.detail)).toEqual([
      "runs 22.11.0; pin node:22.23.4-alpine and redeploy",
      "runs 22.11.0; pin node:22.23.4-alpine and redeploy",
    ]);
    const single = renderEvents("node.security_update", [node("p1")], ctx);
    expect(single.summary).toContain("Pin node:22.23.4-alpine and redeploy.");
  });

  it("escapes markdown in user-controlled text", () => {
    const msg = renderEvents("vuln.new", [vuln("p1", "evil_*pkg*", "high")], ctx);
    expect(toMarkdown(msg)).toContain("evil\\_\\*pkg\\*");
  });
});

describe("webhook signature", () => {
  it("is an HMAC over timestamp and body", () => {
    expect(signWebhook("secret", "1700000000", '{"a":1}')).toBe(
      "sha256=" + createHmac("sha256", "secret").update('1700000000.{"a":1}').digest("hex"),
    );
  });
});

describe("request errors", () => {
  it("reports the underlying network error", async () => {
    await expect(request("http://127.0.0.1:4999/x", { json: {} }, 2000)).rejects.toThrow(/ECONNREFUSED/);
    await expect(request("http://127.0.0.1:9/x", { json: {} }, 2000)).rejects.toThrow(/bad port/);
    expect(describeFetchError(Object.assign(new Error("t"), { name: "TimeoutError" }), 15000)).toBe(
      "timed out after 15s",
    );
  });
});
