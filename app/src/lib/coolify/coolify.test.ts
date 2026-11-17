// SPDX-License-Identifier: FSL-1.1-ALv2
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoolifyServerRecord, ProjectRecord } from "@/lib/pb/types";
import {
  coolifyBase,
  coolifyRefusal,
  deployApplication,
  parseApplications,
  parseDatabases,
  parseServiceImages,
  parseServices,
} from "./client";

// A Coolify server on the internet as far as the outbound check goes.
vi.mock("@/lib/outbound", () => ({
  checkOutbound: async () => {},
  OutboundError: class extends Error {},
  isRedirect: (status: number) => status >= 300 && status < 400,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("coolifyBase", () => {
  it("takes the server's address however it is typed", () => {
    expect(coolifyBase("https://coolify.example.com/")).toBe("https://coolify.example.com");
    expect(coolifyBase(" https://coolify.example.com/api/v1 ")).toBe("https://coolify.example.com");
    expect(coolifyBase("https://example.com/coolify/api/v1/")).toBe("https://example.com/coolify");
    expect(coolifyBase("coolify.example.com")).toBeNull();
    expect(coolifyBase("ftp://coolify.example.com")).toBeNull();
  });
});

describe("databases and services", () => {
  it("reads databases with their kind and image, skipping what is not one", () => {
    expect(
      parseDatabases([
        {
          uuid: "d1aaaaaaaaaaaaaaaaaaaaaa",
          name: "shop-db",
          database_type: "standalone-mariadb",
          image: "mariadb:11",
        },
        {
          uuid: "d2aaaaaaaaaaaaaaaaaaaaaa",
          name: "",
          database_type: "standalone-postgresql",
          image: "postgres:16",
        },
        { uuid: "not a uuid", name: "x", image: "redis:7" },
      ]),
    ).toEqual([
      { uuid: "d1aaaaaaaaaaaaaaaaaaaaaa", name: "shop-db", kind: "mariadb", image: "mariadb:11" },
      {
        uuid: "d2aaaaaaaaaaaaaaaaaaaaaa",
        name: "d2aaaaaaaaaaaaaaaaaaaaaa",
        kind: "postgresql",
        image: "postgres:16",
      },
    ]);
    expect(parseDatabases({ message: "no" })).toEqual([]);
  });

  it("reads services, and the images of a service's parts", () => {
    expect(
      parseServices([{ uuid: "s1aaaaaaaaaaaaaaaaaaaaaa", name: "stats", service_type: "analytics" }]),
    ).toEqual([{ uuid: "s1aaaaaaaaaaaaaaaaaaaaaa", name: "stats", type: "analytics" }]);
    expect(
      parseServiceImages({
        applications: [{ name: "web", image: "ghcr.io/acme/web-app:2" }],
        databases: [
          { name: "db", image: "postgres:16-alpine" },
          { name: "empty", image: "" },
        ],
      }),
    ).toEqual([
      { name: "web", image: "ghcr.io/acme/web-app:2" },
      { name: "db", image: "postgres:16-alpine" },
    ]);
  });
});

describe("parseApplications", () => {
  it("reads name, uuid, domains and build pack, and skips the rest", () => {
    expect(
      parseApplications([
        {
          uuid: "abc123def456ghi789jkl012",
          name: "webshop",
          fqdn: "https://www.example.org,https://example.org/shop",
          build_pack: "dockerfile",
        },
        { uuid: "not a uuid!", name: "x" },
        { name: "no uuid" },
      ]),
    ).toEqual([
      {
        uuid: "abc123def456ghi789jkl012",
        name: "webshop",
        domains: ["www.example.org", "example.org"],
        buildPack: "dockerfile",
      },
    ]);
    expect(parseApplications({ message: "Unauthenticated." })).toEqual([]);
  });
});

describe("deployApplication", () => {
  const access = { base: "https://coolify.example.com", uuid: "abc123def456ghi789jkl012", token: "tok" };

  it("always starts a rebuild: without force Coolify reuses the old image", async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ deployments: [] }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await deployApplication(access)).toMatchObject({ ok: true, message: "Rebuild started" });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      "https://coolify.example.com/api/v1/deploy?uuid=abc123def456ghi789jkl012&force=true",
    ]);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer tok" }),
    });
  });

  it("says when the token may not deploy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: "Missing required permissions: deploy" }, { status: 403 })),
    );
    expect(await deployApplication(access)).toMatchObject({
      ok: false,
      message: "the token lacks the deploy permission; add it in Coolify (Keys & Tokens → API Tokens)",
    });
  });
});

describe("coolifyRefusal", () => {
  const refusal = (message: string, status = 403) => coolifyRefusal(Response.json({ message }, { status }));

  it("explains each refusal of Coolify's API middleware", async () => {
    expect(await refusal("Unauthenticated.", 401)).toMatch(/^Coolify does not know this token/);
    expect(await refusal("Invalid token.", 401)).toMatch(/its team is not one of its creator's teams/);
    expect(await refusal("API is disabled.")).toMatch(/^Coolify's API is off/);
    // Seen on a real server with a valid token: Allowed IPs did not include the caller.
    expect(await refusal("You are not allowed to access the API.")).toMatch(
      /add the public IPv4 and IPv6 address of Observator's server under Allowed IPs/,
    );
    expect(await refusal("Missing required permissions: read")).toBe(
      "the token lacks the read permission; add it in Coolify (Keys & Tokens → API Tokens)",
    );
    // Anything else is passed on as Coolify wrote it.
    expect(
      await refusal(
        "This API token has more access than you have in this team. Revoke it and create a new token.",
      ),
    ).toBe(
      "Coolify answered HTTP 403: This API token has more access than you have in this team. Revoke it and create a new token.",
    );
  });

  it("tells a proxy's refusal apart from Coolify's", async () => {
    const html = new Response("<html><title>Attention Required! | Cloudflare</title></html>", {
      status: 403,
    });
    expect(await coolifyRefusal(html)).toBe(
      "HTTP 403, not from Coolify's API: is something in front of it (a proxy, Cloudflare) blocking Observator?",
    );
    expect(await coolifyRefusal(new Response("Bad Gateway", { status: 502 }))).toBe(
      "Coolify answered HTTP 502",
    );
  });

  it("keeps Coolify's text to one short line", async () => {
    const shown = await refusal(`line one\nline two ${"x".repeat(500)}`, 500);
    expect(shown).toMatch(/^Coolify answered HTTP 500: line one line two x+$/);
    expect(shown.length).toBeLessThan(260);
    // A body too long to be a refusal is not read to the end, and is not Coolify's JSON.
    const huge = new Response(JSON.stringify({ message: "x".repeat(10_000) }), { status: 403 });
    expect(await coolifyRefusal(huge)).toMatch(/^HTTP 403, not from Coolify's API/);
  });
});

describe("projectCoolify", () => {
  async function load() {
    vi.resetModules();
    vi.stubEnv("SECRETS_KEY", randomBytes(32).toString("base64"));
    const secrets = await import("@/lib/secrets");
    const access = await import("./access");
    const { SERVER_TOKEN } = await import("./servers");
    const { WEBHOOK_TOKEN, WEBHOOK_URL } = await import("@/lib/data/projects");
    return { secrets, access, SERVER_TOKEN, WEBHOOK_TOKEN, WEBHOOK_URL };
  }

  it("uses the linked server before the deploy webhook", async () => {
    const { secrets, access, SERVER_TOKEN, WEBHOOK_TOKEN, WEBHOOK_URL } = await load();
    const server = {
      id: "srv1",
      name: "cooli",
      url: "https://coolify.example.com",
      token: secrets.seal("server-token", SERVER_TOKEN),
    } as CoolifyServerRecord;
    const webhook = {
      deployWebhookUrl: secrets.seal(
        "https://other.example.com/api/v1/deploy?uuid=abcd1234efgh",
        WEBHOOK_URL,
      ),
      deployWebhookToken: secrets.seal("webhook-token", WEBHOOK_TOKEN),
    };
    const project = (fields: Partial<ProjectRecord>) => ({
      coolifyServer: "",
      coolifyUuid: "",
      ...webhook,
      ...fields,
    });
    const servers = new Map([[server.id, server]]);

    expect(
      await access.projectCoolify(
        project({ coolifyServer: "srv1", coolifyUuid: "abc123def456ghi789jkl012" }),
        servers,
      ),
    ).toEqual({
      base: "https://coolify.example.com",
      uuid: "abc123def456ghi789jkl012",
      token: "server-token",
      via: "link",
    });
    // Not linked to a server: the deploy webhook, as before.
    expect(await access.projectCoolify(project({}), servers)).toEqual({
      base: "https://other.example.com",
      uuid: "abcd1234efgh",
      token: "webhook-token",
      via: "webhook",
    });
    expect(
      await access.projectCoolify({
        coolifyServer: "",
        coolifyUuid: "",
        deployWebhookUrl: "",
        deployWebhookToken: "",
      }),
    ).toBeNull();
  });
});
