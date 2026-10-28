// SPDX-License-Identifier: FSL-1.1-ALv2
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IssueEvent } from "@/lib/issues/events";
import { describeFetchError, request } from "./channels/types";
import { signWebhook } from "./channels/webhook";
import { toMarkdown, toPlainText } from "./message";
import { countedEvents } from "./publish";
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

  const runtimeEvent = (projectId: string, runtime = "node"): IssueEvent => ({
    type: "runtime.security_update",
    projectId,
    kind: "runtime_security",
    key: `runtime_security:${runtime}:22`,
    revision: "22.23.4",
    severity: "high",
    title: "",
    occurredAt: "2026-10-25T00:00:00.000Z",
    data: {
      runtime,
      running: "22.11.0",
      target: "22.23.4",
      line: "22",
      securityReleases: ["22.23.4"],
      os: "alpine",
    },
  });

  it("groups one runtime security release across projects", () => {
    const msg = renderEvents("runtime.security_update", [runtimeEvent("p1"), runtimeEvent("p2")], ctx);
    expect(msg.title).toBe("Node.js security update for 2 projects");
    expect(msg.items.map((i) => i.detail)).toEqual([
      "runs Node.js 22.11.0; pin node:22.23.4-alpine and redeploy",
      "runs Node.js 22.11.0; pin node:22.23.4-alpine and redeploy",
    ]);
    expect(msg.actions).toEqual([{ label: "Runtimes overview", url: "https://obs.example.com/runtimes" }]);
    const single = renderEvents("runtime.security_update", [runtimeEvent("p1")], ctx);
    expect(single.title).toBe("Node.js security update for api: 22.23.4");
    expect(single.summary).toContain("Pin node:22.23.4-alpine and redeploy.");
  });

  it("advises a version where it knows no image to pin", () => {
    const single = renderEvents("runtime.security_update", [runtimeEvent("p1", "deno")], ctx);
    expect(single.summary).toContain("api runs Deno 22.11.0.");
    expect(single.summary).toContain("Move to 22.23.4 and redeploy.");
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
  it("refuses the container itself, link-local addresses and PocketBase", async () => {
    await expect(request("http://127.0.0.1:4999/x", { json: {} }, 2000)).rejects.toThrow(/refused: .*local/);
    await expect(request("http://169.254.169.254/latest", { json: {} }, 2000)).rejects.toThrow(/link-local/);
    await expect(request("http://[::1]:8090/", { json: {} }, 2000)).rejects.toThrow(/refused/);
    await expect(request("file:///etc/passwd", { json: {} }, 2000)).rejects.toThrow(/only http/);
  });

  it("reports the underlying network error", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.9:4999"), { code: "ECONNREFUSED" }),
    });
    expect(describeFetchError(refused, 15000)).toBe("ECONNREFUSED");
    expect(describeFetchError(Object.assign(new Error("t"), { name: "TimeoutError" }), 15000)).toBe(
      "timed out after 15s",
    );
  });
});

describe("countedEvents", () => {
  const prod = vuln("p1", "lodash", "high");
  const dev = { ...vuln("p1", "vite", "high"), data: { ...vuln("p1", "vite", "high").data, dev: true } };
  const runtime = {
    ...prod,
    type: "runtime.security_update",
    kind: "runtime_security",
    data: {},
  } as IssueEvent;

  it("drops advisories in dev dependencies unless they count", () => {
    expect(countedEvents([prod, dev, runtime], false)).toEqual([prod, runtime]);
    expect(countedEvents([prod, dev, runtime], true)).toEqual([prod, dev, runtime]);
  });
});
