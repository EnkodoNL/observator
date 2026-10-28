// SPDX-License-Identifier: FSL-1.1-ALv2
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const key = () => randomBytes(32).toString("base64");

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("./secrets");
}

afterEach(() => vi.unstubAllEnvs());

describe("secrets", () => {
  it("round-trips, and differs per call", async () => {
    const s = await load({ SECRETS_KEY: key() });
    const a = s.seal("tok_123", "projects.deployWebhookToken");
    expect(a).toMatch(/^enc:v1:[0-9a-f]{8}:/);
    expect(a).not.toContain("tok_123");
    expect(s.seal("tok_123", "projects.deployWebhookToken")).not.toBe(a);
    expect(s.unseal(a, "projects.deployWebhookToken")).toBe("tok_123");
    expect(s.isCurrent(a)).toBe(true);
  });

  it("refuses a value moved to another field", async () => {
    const s = await load({ SECRETS_KEY: key() });
    const a = s.seal("tok_123", "projects.deployWebhookToken");
    expect(() => s.unseal(a, "channels.botToken")).toThrow();
  });

  it("reads values from before encryption as they are", async () => {
    const s = await load({ SECRETS_KEY: key() });
    expect(s.unseal("plain", "x")).toBe("plain");
    expect(s.unseal("", "x")).toBe("");
    expect(s.seal("", "x")).toBe("");
  });

  it("refuses to store a secret without SECRETS_KEY", async () => {
    const s = await load({ SECRETS_KEY: "" });
    expect(() => s.seal("tok", "x")).toThrow(s.SecretsKeyError);
  });

  it("still reads values under the previous key during a rotation", async () => {
    const old = key();
    const before = (await load({ SECRETS_KEY: old })).seal("tok", "x");
    const s = await load({ SECRETS_KEY: key(), SECRETS_KEY_PREVIOUS: old });
    expect(s.unseal(before, "x")).toBe("tok");
    expect(s.isCurrent(before)).toBe(false);
    const fresh = await load({ SECRETS_KEY: key(), SECRETS_KEY_PREVIOUS: "" });
    expect(() => fresh.unseal(before, "x")).toThrow(fresh.SecretsKeyError);
  });
});
