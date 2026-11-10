// SPDX-License-Identifier: FSL-1.1-ALv2
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDeployments } from "./coolify";

// A Coolify server on the internet as far as the outbound check goes.
vi.mock("@/lib/outbound", () => ({
  checkOutbound: async () => {},
  OutboundError: class extends Error {},
}));
afterEach(() => vi.unstubAllGlobals());

const access = { base: "https://coolify.example.com", uuid: "app1", token: "tok" };
const answer = (body: unknown, status = 200) => vi.fn(async () => Response.json(body, { status }));

describe("fetchDeployments", () => {
  it("asks for the application's last deploys with the token", async () => {
    const fetch = answer({
      count: 1,
      deployments: [
        { deployment_uuid: "d1", status: "finished", commit: "abc", created_at: "2026-11-05T09:00:00Z" },
      ],
    });
    vi.stubGlobal("fetch", fetch);
    const result = await fetchDeployments(access);
    expect(fetch).toHaveBeenCalledWith(
      "https://coolify.example.com/api/v1/deployments/applications/app1?take=10",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer tok" }) }),
    );
    expect(result).toMatchObject([{ uuid: "d1", commit: "abc" }]);
  });

  it("says why when Coolify will not tell", async () => {
    vi.stubGlobal("fetch", answer({ message: "Forbidden" }, 403));
    expect(await fetchDeployments(access)).toMatch(/read permission/);
    vi.stubGlobal("fetch", answer({ message: "Application not found" }, 404));
    expect(await fetchDeployments(access)).toMatch(/no deployment history/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      }),
    );
    expect(await fetchDeployments(access)).toBe("Coolify timed out");
  });
});
