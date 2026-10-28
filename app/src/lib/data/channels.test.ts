// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { mergeConfig } from "./channels";

describe("mergeConfig", () => {
  const stored = { serverUrl: "https://ntfy.example.com", topic: "obs", token: "tk_secret" };

  it("keeps a stored secret while the server stays the same", () => {
    const res = mergeConfig("ntfy", { serverUrl: "https://ntfy.example.com/", topic: "other" }, stored);
    expect(res).toMatchObject({ ok: true, config: { token: "tk_secret", topic: "other" } });
  });

  it("drops a stored secret when the server moves", () => {
    const res = mergeConfig("ntfy", { serverUrl: "https://evil.example", topic: "obs" }, stored);
    expect(res.ok && res.config.token).toBeFalsy();
  });

  it("asks for a required secret again when the server moves", () => {
    const res = mergeConfig(
      "gotify",
      { serverUrl: "https://evil.example" },
      { serverUrl: "https://gotify.example.com", appToken: "A.secret" },
    );
    expect(res).toMatchObject({ ok: false, errors: { "config.appToken": expect.stringContaining("again") } });
  });
});

describe("masked URLs", () => {
  const stored = { url: "https://user:pass@hooks.example.com/in?token=abc", secret: "" };

  it("hides credentials when shown and keeps them when saved back unchanged", async () => {
    const { toView } = await import("./channels");
    const view = toView({ id: "c", type: "webhook", name: "w", enabled: true, config: stored } as never);
    expect(view.config.url).toBe("https://…@hooks.example.com/in?…");
    const res = mergeConfig("webhook", { url: view.config.url }, stored);
    expect(res).toMatchObject({ ok: true, config: { url: stored.url } });
  });
});
