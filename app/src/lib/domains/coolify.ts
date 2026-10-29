// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { WEBHOOK_TOKEN, WEBHOOK_URL } from "@/lib/data/projects";
import { kvGet, kvSet } from "@/lib/kv";
import { checkOutbound, OutboundError } from "@/lib/outbound";
import type { ProjectRecord } from "@/lib/pb/types";
import { SecretsKeyError, unseal } from "@/lib/secrets";
import { parseNames, type ParsedName } from "./names";

/*
 * The domains a Coolify resource is served on, from the project's deploy webhook: its URL names
 * the Coolify server and the resource (…/api/v1/deploy?uuid=…), its token authenticates. Reading
 * needs the token's "read" permission; a deploy-only token gets 403, and then nothing changes.
 */

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

/** "https://a.example.com,https://b.example.com:8443" to bare names. */
const fqdnNames = (fqdn: unknown): string[] =>
  typeof fqdn === "string"
    ? fqdn
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

/**
 * The domains in an application from GET /api/v1/applications/{uuid}: fqdn, and for a Docker
 * Compose application the per-service domains, a JSON string of {service: {domain: "…"}}.
 */
export function applicationDomains(app: { fqdn?: unknown; docker_compose_domains?: unknown }): string[] {
  const names = fqdnNames(app.fqdn);
  if (typeof app.docker_compose_domains === "string" && app.docker_compose_domains) {
    try {
      const services = JSON.parse(app.docker_compose_domains) as Record<string, { domain?: unknown }>;
      for (const s of Object.values(services ?? {})) names.push(...fqdnNames(s?.domain));
    } catch {
      // Not JSON: nothing from it.
    }
  }
  return names;
}

/** The domains of a service from GET /api/v1/services/{uuid}: each of its applications' fqdn. */
export function serviceDomains(service: { applications?: { fqdn?: unknown }[] }): string[] {
  return (service.applications ?? []).flatMap((a) => fqdnNames(a.fqdn));
}

export interface CoolifySync {
  at: string;
  error: string | null;
  names: number;
}

const statusKey = (projectId: string) => `coolify:domains:${projectId}`;
export const coolifyStatus = (projectId: string) => kvGet<CoolifySync>(statusKey(projectId));

async function get(url: string, token: string): Promise<Response> {
  return fetch(url, {
    headers: { accept: "application/json", authorization: `Bearer ${token}`, "user-agent": "observator" },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
}

/**
 * The names a project's Coolify resource is served on, or why they could not be read. Null when
 * the project has no Coolify webhook. The outcome is kept for the project's page.
 */
export async function coolifyNames(
  project: Pick<ProjectRecord, "id" | "deployWebhookUrl" | "deployWebhookToken">,
): Promise<ParsedName[] | null> {
  let url: string;
  let token: string;
  try {
    url = unseal(project.deployWebhookUrl, WEBHOOK_URL);
    token = unseal(project.deployWebhookToken, WEBHOOK_TOKEN);
  } catch (err) {
    if (err instanceof SecretsKeyError) return null;
    throw err;
  }
  const target = url ? coolifyTarget(url) : null;
  if (!target || !token) return null;

  const fail = async (error: string) => {
    await kvSet(statusKey(project.id), {
      at: new Date().toISOString(),
      error,
      names: 0,
    } satisfies CoolifySync);
    return null;
  };
  try {
    await checkOutbound(target.base);
  } catch (err) {
    if (err instanceof OutboundError) return fail(`refused: ${err.message}`);
    throw err;
  }
  try {
    let names: string[];
    const app = await get(`${target.base}/api/v1/applications/${target.uuid}`, token);
    if (app.status === 404) {
      const service = await get(`${target.base}/api/v1/services/${target.uuid}`, token);
      if (!service.ok) return fail(answer(service.status));
      names = serviceDomains(await service.json());
    } else if (!app.ok) return fail(answer(app.status));
    else names = applicationDomains(await app.json());
    const parsed = parseNames(names).names;
    await kvSet(statusKey(project.id), {
      at: new Date().toISOString(),
      error: null,
      names: parsed.length,
    } satisfies CoolifySync);
    return parsed;
  } catch (err) {
    return fail(
      err instanceof Error && err.name === "TimeoutError" ? "Coolify timed out" : "Coolify unreachable",
    );
  }
}

function answer(status: number): string {
  if (status === 401 || status === 403)
    return "the token cannot read this resource; give it the read permission (next to deploy)";
  return `Coolify answered HTTP ${status}`;
}
