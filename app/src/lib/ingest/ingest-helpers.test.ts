// SPDX-License-Identifier: FSL-1.1-ALv2
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { diffComponents } from "./changes";
import { extractFiles, IngestError, parseFailOn, parseMeta, readBody } from "./request";
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

  it("accepts base64-encoded gzip, as sent by the Alpine snippet", () => {
    const b64 = gzipSync(tarOf({ "package.json": "{}" }))
      .toString("base64")
      .replace(/(.{76})/g, "$1\n");
    expect(extractFiles(Buffer.from(b64 + "\n")).packageJson).toBe("{}");
  });

  it("requires package.json and rejects non-gzip bodies", () => {
    expect(() => extractFiles(gzipSync(tarOf({ "yarn.lock": "x" })))).toThrow(/package.json missing/);
    expect(() => extractFiles(Buffer.from("plain"))).toThrow(IngestError);
  });
});

describe("readBody", () => {
  it("enforces the cap while streaming", async () => {
    const request = new Request("http://x", { method: "POST", body: new Uint8Array(2048) });
    await expect(readBody(request, 1024)).rejects.toMatchObject({ status: 413 });
    const ok = new Request("http://x", { method: "POST", body: new Uint8Array(10) });
    expect((await readBody(ok, 1024)).length).toBe(10);
  });
});

describe("headers", () => {
  it("parses the snippet's metadata", () => {
    const meta = parseMeta(
      new Headers({
        "x-node-version": "v22.11.0",
        "x-platform": "linux/arm64",
        "x-os": "Alpine",
        "x-fail-on": "",
      }),
    );
    expect(meta).toEqual({
      nodeVersion: "22.11.0",
      platform: "linux",
      arch: "arm64",
      os: "alpine",
      failOn: { severity: null, node: false },
    });
    expect(() => parseMeta(new Headers())).toThrow(IngestError);
    expect(
      parseMeta(new Headers({ "x-node-version": "22.1.0", "x-platform": "../etc", "x-os": "a b" })),
    ).toMatchObject({
      platform: "",
      os: "",
    });
  });

  it("parses the build gate", () => {
    expect(parseFailOn("high,node")).toEqual({ severity: "high", node: true });
    expect(parseFailOn(" medium ")).toEqual({ severity: "moderate", node: false });
    expect(parseFailOn("bogus")).toEqual({ severity: null, node: false });
  });
});

describe("renderReport", () => {
  it("prints a gate line only when the gate is enabled", () => {
    const base: ReportInput = {
      projectName: "api",
      projectUrl: "https://obs/projects/api",
      nodeVersion: "22.11.0",
      platform: "linux/x64",
      lockfileType: "npm",
      packageCount: 3,
      lockfileChanged: true,
      warnings: [],
      packagesPending: false,
      gate: null,
    };
    expect(renderReport(base)).toBe(
      "Observator: recorded build for api (node v22.11.0, linux/x64, npm, 3 packages)\n",
    );
    expect(renderReport({ ...base, gate: "fail", gateReason: "1 critical" })).toContain(
      "OBSERVATOR_GATE=fail (1 critical)",
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
