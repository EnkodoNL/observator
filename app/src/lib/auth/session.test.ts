// SPDX-License-Identifier: FSL-1.1-ALv2
import { afterEach, describe, expect, it, vi } from "vitest";

// No session cookie; the referer is the page a demo visitor clicked on.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ referer: "http://localhost:3000/settings/channels?x=1" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

async function load(demo: string) {
  vi.resetModules();
  vi.stubEnv("DEMO_MODE", demo);
  return import("./session");
}

afterEach(() => vi.unstubAllEnvs());

describe("sessions without a cookie", () => {
  it("go to the login page normally", async () => {
    const s = await load("off");
    await expect(s.requireUser()).rejects.toThrow("redirect:/login");
  });

  it("get the read-only demo session in DEMO_MODE", async () => {
    const s = await load("on");
    await expect(s.requireUser()).resolves.toMatchObject({ readOnly: true, user: { id: "demo" } });
  });

  it("cannot change anything in DEMO_MODE: back to the page, with a note", async () => {
    const s = await load("on");
    await expect(s.requireWriter()).rejects.toThrow("redirect:/settings/channels?demo=read-only");
  });
});
