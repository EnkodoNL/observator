// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { safeNext } from "./forms";

describe("safeNext", () => {
  it.each([
    ["/projects/api?tab=setup#x", "/projects/api?tab=setup#x"],
    ["/settings/channels", "/settings/channels"],
  ])("keeps the path %s", (value, expected) => {
    expect(safeNext(value)).toBe(expected);
  });

  it.each([
    [undefined],
    [""],
    ["https://evil.com"],
    ["//evil.com"],
    ["/\\evil.com"],
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    ["/ /evil.com"],
    ["javascript:alert(1)"],
    ["/%09/evil.com"],
  ])("sends %j home", (value) => {
    const out = safeNext(value);
    expect(out === "/" || out.startsWith("/%")).toBe(true);
    expect(new URL(out, "https://obs.example").origin).toBe("https://obs.example");
  });
});
