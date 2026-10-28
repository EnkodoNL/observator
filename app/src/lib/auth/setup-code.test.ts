// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { newSetupCode, normalizeSetupCode } from "./setup-code";

describe("setup code", () => {
  it("is three groups of four unambiguous characters", () => {
    for (let i = 0; i < 50; i++)
      expect(newSetupCode()).toMatch(/^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){2}$/);
  });

  it("ignores case, spaces and dashes when typed in", () => {
    expect(normalizeSetupCode(" abcd efgh-jkmn ")).toBe(normalizeSetupCode("ABCD-EFGH-JKMN"));
  });
});
