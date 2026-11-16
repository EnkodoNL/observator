// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { checkOutbound, OutboundError } from "@/lib/outbound";

/** The Coolify server and resource a deploy webhook points at, or null when it is not one. */
export function coolifyTarget(webhookUrl: string): { base: string; uuid: string } | null {
  let url: URL;
  try {
    url = new URL(webhookUrl);
  } catch {
    return null;
  }
  const at = url.pathname.replace(/\/+$/, "").lastIndexOf("/api/v1/deploy");
  if (at < 0 || !url.pathname.replace(/\/+$/, "").endsWith("/api/v1/deploy")) return null;
  // The parameter may list several resources; the first is the one this project is.
  const uuid = (url.searchParams.get("uuid") ?? "").split(",")[0].trim();
  if (!/^[a-z0-9-]{8,64}$/i.test(uuid)) return null;
  return { base: `${url.origin}${url.pathname.slice(0, at)}`, uuid };
}

/** Where and how to reach one Coolify application: the server, the application, a token. */
export interface CoolifyAccess {
  base: string;
  uuid: string;
  token: string;
}

/** A Coolify uuid as Coolify writes them, and as a build passes COOLIFY_RESOURCE_UUID. */
export const COOLIFY_UUID = /^[a-z0-9]{8,64}$/;

export async function coolifyGet(url: string, token: string): Promise<Response> {
  return fetch(url, {
    headers: { accept: "application/json", authorization: `Bearer ${token}`, "user-agent": "observator" },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
}

export function coolifyAnswer(status: number): string {
  if (status === 401 || status === 403)
    return "the token cannot read this resource; give it the read permission (next to deploy)";
  return `Coolify answered HTTP ${status}`;
}

/** "https://coolify.example.com/" or "…/api/v1" to the server's base URL; null when not a URL. */
export function coolifyBase(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return `${url.origin}${path}`;
}

/** Runs a request against a Coolify server, turning refusals and timeouts into a reason. */
export async function coolifyRequest<T>(base: string, run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    await checkOutbound(base);
  } catch (err) {
    if (err instanceof OutboundError) return { error: `refused: ${err.message}` };
    throw err;
  }
  try {
    return await run();
  } catch (err) {
    return {
      error:
        err instanceof Error && err.name === "TimeoutError" ? "Coolify timed out" : "Coolify unreachable",
    };
  }
}

/** One application from GET /api/v1/applications, as the Setup tab and MCP show it. */
export interface CoolifyApplication {
  uuid: string;
  name: string;
  /** Its domains, from fqdn ("https://a.example.com,https://b.example.com"). */
  domains: string[];
  buildPack: string;
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

export function parseApplications(body: unknown): CoolifyApplication[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((a: Record<string, unknown>) => {
    const uuid = text(a?.uuid);
    if (!COOLIFY_UUID.test(uuid)) return [];
    return [
      {
        uuid,
        name: text(a.name) || uuid,
        domains: text(a.fqdn)
          .split(",")
          .map((d) =>
            d
              .trim()
              .replace(/^https?:\/\//, "")
              .replace(/\/.*$/, ""),
          )
          .filter(Boolean),
        buildPack: text(a.build_pack),
      },
    ];
  });
}

/** Every application the token can read, or why not. */
export async function listApplications(server: {
  base: string;
  token: string;
}): Promise<CoolifyApplication[] | { error: string }> {
  return coolifyRequest(server.base, async () => {
    const res = await coolifyGet(`${server.base}/api/v1/applications`, server.token);
    if (!res.ok) return { error: coolifyAnswer(res.status) };
    return parseApplications(await res.json());
  });
}

/** Whether this server has the application: how a uuid from a build finds its server. */
export async function hasApplication(
  server: { base: string; token: string },
  uuid: string,
): Promise<boolean> {
  const answer = await coolifyRequest(server.base, async () => {
    const res = await coolifyGet(`${server.base}/api/v1/applications/${uuid}`, server.token);
    return res.ok;
  });
  return answer === true;
}

/**
 * Starts a rebuild over the API (permission deploy). Always with force: without it Coolify reuses
 * the image it built for the same commit and builds nothing, so a moving tag such as node:26
 * keeps its old image. force builds with --pull --no-cache.
 */
export async function deployApplication(
  access: CoolifyAccess,
): Promise<{ ok: boolean; status?: number; message: string }> {
  const answer = await coolifyRequest(access.base, async () => {
    const url = `${access.base}/api/v1/deploy?uuid=${encodeURIComponent(access.uuid)}&force=true`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${access.token}`,
        "user-agent": "observator",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    return {
      ok: res.ok,
      status: res.status,
      message: res.ok
        ? "Rebuild started"
        : res.status === 401 || res.status === 403
          ? "the token cannot deploy; give it the deploy permission"
          : `Coolify answered HTTP ${res.status}`,
    };
  });
  return "error" in answer ? { ok: false, message: answer.error } : answer;
}
