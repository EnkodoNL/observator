// SPDX-License-Identifier: FSL-1.1-ALv2
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { diffComponents } from "./changes";
import {
  extractFiles,
  IngestError,
  normalizePlatform,
  parseFailOn,
  parseMeta,
  parseRuntimes,
  readBody,
} from "./request";
import { renderReport, type ReportInput } from "./report";
import { RateLimiter } from "@/lib/rate-limit";

function tarOf(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const h = Buffer.alloc(512);
    h.write(name, 0);
    h.write("0000644\0", 100);
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("0", 156);
    h.write("ustar\0", 257);
    h.fill(0x20, 148, 156);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

describe("diffComponents", () => {
  it("reports added, removed and changed packages by name", () => {
    const before = [
      { name: "a", version: "1.0.0" },
      { name: "b", version: "1.0.0" },
      { name: "c", version: "2.0.0" },
    ];
    const after = [
      { name: "a", version: "1.0.0" },
      { name: "c", version: "2.1.0" },
      { name: "d", version: "0.1.0" },
    ];
    expect(diffComponents(before, after)).toEqual({
      added: [{ name: "d", version: "0.1.0" }],
      removed: [{ name: "b", version: "1.0.0" }],
      changed: [{ name: "c", from: "2.0.0", to: "2.1.0" }],
    });
  });

  it("caps very large diffs", () => {
    const after = Array.from({ length: 700 }, (_, i) => ({ name: `p${i}`, version: "1.0.0" }));
    const diff = diffComponents([], after);
    expect(diff.added).toHaveLength(500);
    expect(diff.truncated).toBe(true);
  });
});

describe("extractFiles", () => {
  it("keeps only the expected top-level files", () => {
    const body = gzipSync(
      tarOf({
        "./package.json": "{}",
        "yarn.lock": "x",
        "src/package.json": "nope",
        "._package.json": "mac",
      }),
    );
    expect(extractFiles(body)).toEqual({ packageJson: "{}", lockfiles: { "yarn.lock": "x" } });
  });

  it("accepts base64-encoded gzip, as sent through BusyBox wget", () => {
    const b64 = gzipSync(tarOf({ "package.json": "{}" }))
      .toString("base64")
      .replace(/(.{76})/g, "$1\n");
    expect(extractFiles(Buffer.from(b64 + "\n")).packageJson).toBe("{}");
  });

  it("accepts an image without package.json, but not a body that is not gzip", () => {
    // The snippet sends an empty body when it finds no manifests at all.
    expect(extractFiles(Buffer.alloc(0))).toEqual({ packageJson: null, lockfiles: {} });
    expect(extractFiles(gzipSync(tarOf({ "yarn.lock": "x" })))).toEqual({
      packageJson: null,
      lockfiles: { "yarn.lock": "x" },
    });
    expect(() => extractFiles(Buffer.from("plain"))).toThrow(IngestError);
  });
});

describe("readBody", () => {
  it("enforces the cap while streaming", async () => {
    const request = new Request("http://x", { method: "POST", body: new Uint8Array(2048) });
    await expect(readBody(request, 1024)).rejects.toMatchObject({ status: 413 });
    const ok = new Request("http://x", { method: "POST", body: new Uint8Array(10) });
    expect((await readBody(ok, 1024)).length).toBe(10);
    expect((await readBody(new Request("http://x", { method: "POST" }), 1024)).length).toBe(0);
  });
});

describe("headers", () => {
  it("parses the snippet's metadata", () => {
    const meta = parseMeta(
      new Headers({
        "x-runtime": "node/v22.11.0,python/3.12.4",
        "x-platform": "Linux/aarch64",
        "x-os": "Alpine",
        "x-fail-on": "",
      }),
    );
    expect(meta).toEqual({
      runtimes: [
        { name: "node", version: "22.11.0" },
        { name: "python", version: "3.12.4" },
      ],
      invalidRuntimes: [],
      platform: "linux",
      arch: "arm64",
      os: "alpine",
      failOn: { severity: null, runtimes: [] },
      labels: null,
      domains: null,
    });
    // An empty header clears the build labels; a missing one leaves them.
    const base = { "x-runtime": "node/22.11.0" };
    expect(parseMeta(new Headers({ ...base, "x-labels": "" })).labels).toEqual({ labels: [], invalid: [] });
    expect(parseMeta(new Headers({ ...base, "x-labels": "App:Heatwave, role:web, bad!" })).labels).toEqual({
      labels: ["app:heatwave", "role:web"],
      invalid: ["bad!"],
    });
    // Domains likewise; IPs and junk are set apart for a warning in the build log.
    expect(parseMeta(new Headers({ ...base, "x-domains": "" })).domains).toEqual({ names: [], invalid: [] });
    expect(
      parseMeta(new Headers({ ...base, "x-domains": "App.Example.com, 10.0.0.1 https://api.example.com/" }))
        .domains,
    ).toEqual({
      names: [
        { host: "app.example.com", domain: "example.com" },
        { host: "api.example.com", domain: "example.com" },
      ],
      invalid: ["10.0.0.1"],
    });
    expect(
      parseMeta(new Headers({ "x-runtime": "node/22.1.0", "x-platform": "../etc", "x-os": "a b" })),
    ).toMatchObject({
      platform: "",
      os: "",
    });
  });

  it("records an image without a known runtime", () => {
    expect(parseMeta(new Headers({ "x-runtime": "" })).runtimes).toEqual([]);
  });

  it("tells an outdated snippet apart from a request without the header", () => {
    expect(() => parseMeta(new Headers())).toThrow(/missing X-Runtime/);
    expect(() => parseMeta(new Headers({ "x-node-version": "v22.11.0" }))).toThrow(/snippet is outdated/);
  });

  it("parses runtimes leniently, skipping what it cannot read", () => {
    expect(parseRuntimes(" Node/22.11.0 , bun/1.2.3, node/20.0.0, php, ruby/3.3 x, /1.0, deno/")).toEqual({
      runtimes: [
        { name: "node", version: "22.11.0" },
        { name: "bun", version: "1.2.3" },
      ],
      invalid: ["php", "ruby/3.3 x", "/1.0", "deno/"],
    });
    const many = Array.from({ length: 10 }, (_, i) => `r${String.fromCharCode(97 + i)}/1.0`).join(",");
    const parsed = parseRuntimes(many);
    expect(parsed.runtimes).toHaveLength(8);
    expect(parsed.invalid).toEqual(["ri/1.0", "rj/1.0"]);
    // Only a leading v before a digit is dropped.
    expect(parseRuntimes("x/vnext").runtimes).toEqual([{ name: "x", version: "vnext" }]);
  });

  it.each([
    ["linux/x86_64", "amd64"],
    ["linux/x64", "amd64"],
    ["linux/aarch64", "arm64"],
    ["linux/armv7l", "arm"],
    ["linux/i686", "386"],
    ["linux/riscv64", "riscv64"],
  ])("normalizes %s to %s", (header, arch) => {
    expect(normalizePlatform(header)).toEqual({ platform: "linux", arch });
  });

  it("parses the build gate", () => {
    expect(parseFailOn("high,node")).toEqual({ severity: "high", runtimes: ["node"] });
    expect(parseFailOn("critical runtime")).toEqual({ severity: "critical", runtimes: ["*"] });
    expect(parseFailOn(" medium ")).toEqual({ severity: "moderate", runtimes: [] });
    expect(parseFailOn("bogus")).toEqual({ severity: null, runtimes: [] });
  });
});

describe("renderReport", () => {
  const base: ReportInput = {
    projectName: "api",
    projectUrl: "https://obs/projects/api",
    runtimes: [{ name: "node", version: "22.11.0" }],
    platform: "linux/amd64",
    lockfileType: "npm",
    packageCount: 3,
    lockfileChanged: true,
    warnings: [],
    packagesPending: false,
    gate: null,
  };

  it("prints a gate line only when the gate is enabled", () => {
    expect(renderReport(base)).toBe(
      "Observator: recorded build for api (node 22.11.0, linux/amd64, npm, 3 packages)\n",
    );
    expect(renderReport({ ...base, gate: "fail", gateReason: "1 critical" })).toContain(
      "OBSERVATOR_GATE=fail (1 critical)",
    );
  });

  it("says what is tracked without a lockfile", () => {
    const python = { ...base, runtimes: [{ name: "python", version: "3.12.4" }], lockfileType: "none" };
    expect(renderReport(python)).toBe(
      "Observator: recorded build for api (python 3.12.4, linux/amd64, no lockfile)\n" +
        "Observator: no lockfile found; only the runtime versions are tracked\n",
    );
    expect(renderReport({ ...python, runtimes: [] })).toContain(
      "(no runtime detected, linux/amd64, no lockfile)\nObservator: no runtime and no lockfile found; nothing to check",
    );
  });
});

describe("RateLimiter", () => {
  it("refills over time", () => {
    let now = 0;
    const limiter = RateLimiter.perWindow(2, 1000, () => now);
    expect([limiter.take("k"), limiter.take("k"), limiter.take("k")]).toEqual([true, true, false]);
    now = 500;
    expect(limiter.take("k")).toBe(true);
    expect(limiter.take("k")).toBe(false);
    expect(limiter.take("other")).toBe(true);
  });
});

describe("changeDirection", () => {
  it("compares the highest installed version", async () => {
    const { changeDirection } = await import("./direction");
    expect(changeDirection("4.17.20", "4.18.1")).toBe("up");
    expect(changeDirection("2.0.0, 2.1.1", "2.0.0")).toBe("down");
    expect(changeDirection("1.0.0", "1.0.0")).toBe("other");
    expect(changeDirection("git+abc", "1.0.0")).toBe("other");
  });
});
