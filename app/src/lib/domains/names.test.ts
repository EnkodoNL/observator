// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { parseName, parseNames } from "./names";

describe("parseName", () => {
  it.each([
    ["app.enkodo.dev", "app.enkodo.dev", "enkodo.dev"],
    ["enkodo.dev", "enkodo.dev", "enkodo.dev"],
    ["https://App.Enkodo.dev/path?x=1", "app.enkodo.dev", "enkodo.dev"],
    ["a.foo.co.uk", "a.foo.co.uk", "foo.co.uk"],
    ["shop.bücher.de", "shop.xn--bcher-kva.de", "xn--bcher-kva.de"],
    ["my-app.vercel.app", "my-app.vercel.app", "vercel.app"],
    ["enkodo.nl.", "enkodo.nl", "enkodo.nl"],
  ])("%s -> host %s, domain %s", (input, host, domain) => {
    expect(parseName(input)).toEqual({ host, domain });
  });

  it.each(["co.uk", "localhost", "192.0.2.1", "[2001:db8::1]", "not a name", "", "-bad-.com"])(
    "refuses %j",
    (input) => {
      expect(parseName(input)).toBeNull();
    },
  );
});

describe("parseNames", () => {
  it("splits, dedupes and keeps the refusals apart", () => {
    expect(parseNames("a.enkodo.dev, A.enkodo.dev b.enkodo.dev nope")).toEqual({
      names: [
        { host: "a.enkodo.dev", domain: "enkodo.dev" },
        { host: "b.enkodo.dev", domain: "enkodo.dev" },
      ],
      invalid: ["nope"],
    });
  });
});
