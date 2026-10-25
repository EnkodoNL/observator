// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { packageHref, packageNameFromSegments } from "./package-href";

describe("packageHref", () => {
  it.each([
    ["lodash", "/packages/lodash"],
    ["@types/node", "/packages/@types/node"],
    ["lodash.merge", "/packages/lodash.merge"],
  ])("%s -> %s", (name, href) => {
    expect(packageHref(name)).toBe(href);
  });

  it.each(["lodash", "@types/node", "@scope/name.with-dots"])("round-trips %s", (name) => {
    const segments = packageHref(name).replace("/packages/", "").split("/");
    expect(packageNameFromSegments(segments)).toBe(name);
    // Next may hand over the segments still encoded.
    expect(packageNameFromSegments(segments.map((s) => s.replace("@", "%40")))).toBe(name);
  });
});
