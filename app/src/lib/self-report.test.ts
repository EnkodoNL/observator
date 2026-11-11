// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { sameBuild } from "./self-report";

describe("sameBuild", () => {
  it("records a new build id, also with the same packages, and not a restart", () => {
    expect(sameBuild("b2", "b1")).toBe(false);
    expect(sameBuild("b1", "b1")).toBe(true);
    // The first start after this was added: no id kept yet, so the running build is recorded.
    expect(sameBuild("b1", null)).toBe(false);
    // Development has no build id; the packages and the runtime decide.
    expect(sameBuild(null, "b1")).toBe(true);
  });
});
