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

/** The start of a response body, at most max bytes; the rest is not read. */
async function bodyStart(res: Response, max = 4096): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    // A body that breaks off: what arrived is enough.
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, max));
}

/** Coolify's own words, as data: one line, at most 200 characters. */
const clean = (message: string) =>
  message
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 200);

/**
 * Why Coolify refused a request, from its own message, with what to do about it. The messages
 * are Coolify's API middleware (v4.x, app/Http/Middleware): a 401 or 403 can mean an unknown
 * token, an API that is off or limited to some IPs, or a missing permission. A refusal without
 * Coolify's JSON comes from something in front of it.
 */
export async function coolifyRefusal(res: Response): Promise<string> {
  let message: string | null = null;
  try {
    const body = JSON.parse(await bodyStart(res)) as { message?: unknown } | null;
    if (typeof body?.message === "string" && body.message.trim()) message = clean(body.message);
  } catch {
    // Not JSON: not Coolify's API.
  }
  const status = res.status;
  if (message === null)
    return status === 401 || status === 403
      ? `HTTP ${status}, not from Coolify's API: is something in front of it (a proxy, Cloudflare) blocking Observator?`
      : `Coolify answered HTTP ${status}`;
  if (message === "Unauthenticated.")
    return "Coolify does not know this token (Unauthenticated.): paste the whole token, including the number and | in front, and check that it has not expired or been revoked";
  if (message === "Invalid token.")
    return "Coolify refused the token (Invalid token.): its team is not one of its creator's teams; create a new token";
  if (message === "API is disabled.")
    return "Coolify's API is off: turn on API access under Settings → Advanced in Coolify";
  if (message === "You are not allowed to access the API.")
    return "Coolify accepts the API only from certain IPs: add the public IPv4 and IPv6 address of Observator's server under Allowed IPs (Settings → Advanced in Coolify)";
  const missing = /^Missing required permissions: (.+)$/.exec(message);
  if (missing)
    return `the token lacks the ${missing[1]} permission; add it in Coolify (Keys & Tokens → API Tokens)`;
  return `Coolify answered HTTP ${status}: ${message}`;
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
    if (!res.ok) return { error: await coolifyRefusal(res) };
    return parseApplications(await res.json());
  });
}

/** One standalone database: its kind ("mariadb" from "standalone-mariadb") and its image. */
export interface CoolifyDatabase {
  uuid: string;
  name: string;
  kind: string;
  image: string;
}

export function parseDatabases(body: unknown): CoolifyDatabase[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((d: Record<string, unknown>) => {
    const uuid = text(d?.uuid);
    if (!COOLIFY_UUID.test(uuid)) return [];
    return [
      {
        uuid,
        name: text(d.name).slice(0, 100) || uuid,
        kind: text(d.database_type)
          .replace(/^standalone-/, "")
          .slice(0, 32),
        image: text(d.image).slice(0, 500),
      },
    ];
  });
}

/** One service (a compose stack Coolify runs: a one-click app or your own compose). */
export interface CoolifyService {
  uuid: string;
  name: string;
  type: string;
}

export function parseServices(body: unknown): CoolifyService[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((s: Record<string, unknown>) => {
    const uuid = text(s?.uuid);
    if (!COOLIFY_UUID.test(uuid)) return [];
    return [{ uuid, name: text(s.name).slice(0, 100) || uuid, type: text(s.service_type).slice(0, 64) }];
  });
}

/** The images of a service's parts, from GET /api/v1/services/{uuid}: its applications and databases. */
export function parseServiceImages(body: unknown): { name: string; image: string }[] {
  const service = (body ?? {}) as { applications?: unknown; databases?: unknown };
  const parts = [service.applications, service.databases].flatMap((list) =>
    Array.isArray(list) ? list : [],
  );
  return parts.flatMap((p: Record<string, unknown>) => {
    const image = text(p?.image).slice(0, 500);
    return image ? [{ name: text(p.name).slice(0, 100), image }] : [];
  });
}

/** A Coolify list endpoint, or why it could not be read. */
async function coolifyList<T>(
  server: { base: string; token: string },
  path: string,
  parse: (body: unknown) => T,
): Promise<T | { error: string }> {
  return coolifyRequest(server.base, async () => {
    const res = await coolifyGet(`${server.base}/api/v1/${path}`, server.token);
    if (!res.ok) return { error: await coolifyRefusal(res) };
    return parse(await res.json());
  });
}

/** Every standalone database the token can read (permission read), or why not. */
export const listDatabases = (server: { base: string; token: string }) =>
  coolifyList(server, "databases", parseDatabases);

/** Every service the token can read, or why not. */
export const listServices = (server: { base: string; token: string }) =>
  coolifyList(server, "services", parseServices);

/** The images of one service's parts, or why they could not be read. */
export const serviceImages = (server: { base: string; token: string }, uuid: string) =>
  coolifyList(server, `services/${encodeURIComponent(uuid)}`, parseServiceImages);

/** One finding of Coolify's own image scan (Grype, since Coolify 4.7) on what a resource runs. */
export interface CoolifyFinding {
  /** CVE-…, GHSA-… */
  id: string;
  aliases: string[];
  title: string;
  /** critical, high, medium, low, negligible or unknown, as Coolify writes it. */
  severity: string;
  package: string;
  version: string;
  /** deb, apk, npm, python, go-module, java-archive, binary, ... */
  type: string;
  /** "" when no fixed version exists. */
  fixedIn: string;
  /** In CISA's catalogue of known exploited vulnerabilities. */
  kev: boolean;
  url: string;
  /** Accepted in Coolify itself. */
  ignored: boolean;
}

export interface CoolifyScan {
  findings: CoolifyFinding[];
  /** Why there is no scan: off on the server, not supported, ... */
  off: string | null;
  scannedAt: string | null;
}

export function parseFindings(body: unknown): {
  findings: CoolifyFinding[];
  total: number;
  off: string | null;
  scannedAt: string | null;
} {
  const b = (body ?? {}) as {
    findings?: unknown;
    pagination?: { total?: unknown };
    off_reason?: unknown;
    images?: unknown;
  };
  const findings = (Array.isArray(b.findings) ? b.findings : []).flatMap((f: Record<string, unknown>) => {
    const id = text(f?.display_id) || text(f?.id);
    const pkg = text(f?.package);
    const version = text(f?.version);
    if (!id || !pkg || !version) return [];
    return [
      {
        id: id.slice(0, 64),
        aliases: (Array.isArray(f.aliases) ? f.aliases : [])
          .filter((a): a is string => typeof a === "string")
          .slice(0, 20),
        title: text(f.title).slice(0, 500),
        severity: text(f.severity).toLowerCase(),
        package: pkg.slice(0, 214),
        version: version.slice(0, 128),
        type: (text(f.package_type) || "unknown")
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "")
          .slice(0, 24),
        fixedIn: text(f.fixed_in).slice(0, 128),
        kev: f.kev === true,
        url: text(f.advisory_url).slice(0, 500),
        ignored: f.ignore !== null && f.ignore !== undefined,
      },
    ];
  });
  const scanned = (Array.isArray(b.images) ? b.images : [])
    .map((i: Record<string, unknown>) => text(i?.scanned_at))
    .filter(Boolean)
    .sort();
  return {
    findings,
    total: typeof b.pagination?.total === "number" ? b.pagination.total : findings.length,
    off: text(b.off_reason) || null,
    scannedAt: scanned.at(-1) ?? null,
  };
}

/**
 * Coolify's scan of what a database or service runs, every page of it (permission read). A
 * Coolify without image scanning (before 4.7) answers 404: then there is simply no scan.
 */
export async function resourceScan(
  server: { base: string; token: string },
  kind: "database" | "service",
  uuid: string,
): Promise<CoolifyScan | { error: string }> {
  return coolifyRequest(server.base, async () => {
    const findings: CoolifyFinding[] = [];
    let off: string | null = null;
    let scannedAt: string | null = null;
    for (let page = 1; page <= 10; page++) {
      const url = `${server.base}/api/v1/${kind}s/${encodeURIComponent(uuid)}/vulnerabilities?per_page=200&page=${page}`;
      const res = await coolifyGet(url, server.token);
      if (res.status === 404)
        return {
          findings: [],
          off: "no image scanning in this Coolify (4.7 or newer has it)",
          scannedAt: null,
        };
      if (!res.ok) return { error: await coolifyRefusal(res) };
      const parsed = parseFindings(await res.json());
      findings.push(...parsed.findings);
      off ??= parsed.off;
      scannedAt ??= parsed.scannedAt;
      if (page * 200 >= parsed.total || parsed.findings.length === 0) break;
    }
    return { findings, off, scannedAt };
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
      message: res.ok ? "Rebuild started" : await coolifyRefusal(res),
    };
  });
  return "error" in answer ? { ok: false, message: answer.error } : answer;
}
