// SPDX-License-Identifier: FSL-1.1-ALv2
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpCaller } from "@/lib/data/mcp-tokens";

const findMcpToken = vi.fn<(bearer: string) => Promise<McpCaller | null>>();
const listProjectSummaries = vi.fn();

vi.mock("@/lib/data/mcp-tokens", () => ({
  findMcpToken: (b: string) => findMcpToken(b),
  touchMcpToken: async () => undefined,
}));
vi.mock("@/lib/project-list", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project-list")>()),
  listProjectSummaries: (f: unknown) => listProjectSummaries(f),
}));

const { GET } = await import("./route");

const readOnly: McpCaller = {
  tokenId: "t1",
  tokenPrefix: "obsm_ro",
  canWrite: false,
  lastUsedAt: "",
  userId: "u",
  email: "dev@example.com",
};

const call = (query = "", token?: string) =>
  GET(
    new Request(`http://localhost:3000/api/status${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );

beforeEach(() => {
  findMcpToken.mockReset();
  listProjectSummaries.mockReset();
  findMcpToken.mockImplementation(async (b) => (b === "obsm_good" ? readOnly : null));
});

describe("GET /api/status", () => {
  it("refuses a request without a token", async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: expect.stringContaining("MCP token") });
    expect(listProjectSummaries).not.toHaveBeenCalled();
  });

  it("refuses an unknown token", async () => {
    const res = await call("", "obsm_wrong");
    expect(res.status).toBe(401);
    expect(listProjectSummaries).not.toHaveBeenCalled();
  });

  it("answers a read-only token with projects and counts per status", async () => {
    listProjectSummaries.mockResolvedValue([
      { slug: "web", status: "ok" },
      { slug: "api", status: "vulnerable" },
      { slug: "db", status: "ok" },
    ]);
    const res = await call("?label=env:prod,app:web&label=team:x&status=ok&q=we", "obsm_good");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.counts).toEqual({ none: 0, unchecked: 0, ok: 2, update: 0, vulnerable: 1 });
    expect(body.projects).toHaveLength(3);
    expect(typeof body.generatedAt).toBe("string");
    expect(listProjectSummaries).toHaveBeenCalledWith({
      labels: ["env:prod", "app:web", "team:x"],
      status: "ok",
      query: "we",
    });
  });

  it("rejects an unknown status filter", async () => {
    const res = await call("?status=broken", "obsm_good");
    expect(res.status).toBe(400);
    expect(listProjectSummaries).not.toHaveBeenCalled();
  });

  it("says 503 when the data cannot be read, without the reason", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    listProjectSummaries.mockRejectedValue(new Error("pocketbase down at 10.0.0.5"));
    const res = await call("", "obsm_good");
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.5");
  });
});
