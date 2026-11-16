// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { projectCoolify } from "@/lib/coolify/access";
import { coolifyAnswer, coolifyGet } from "@/lib/coolify/client";
import { kvGet, kvSet } from "@/lib/kv";
import { checkOutbound, OutboundError } from "@/lib/outbound";
import type { CoolifyServerRecord, ProjectRecord } from "@/lib/pb/types";
import { parseNames, type ParsedName } from "./names";

export { coolifyTarget } from "@/lib/coolify/client";

/*
 * The domains a Coolify resource is served on, through the project's link to a Coolify server in
 * Settings, or its deploy webhook (…/api/v1/deploy?uuid=…). Reading needs the token's "read"
 * permission; a deploy-only token gets 403, and then nothing changes.
 */

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

/**
 * The names a project's Coolify resource is served on, or why they could not be read. Null when
 * the project has no Coolify link or webhook. The outcome is kept for the project's page.
 */
export async function coolifyNames(
  project: Pick<
    ProjectRecord,
    "id" | "coolifyServer" | "coolifyUuid" | "deployWebhookUrl" | "deployWebhookToken"
  >,
  servers?: Map<string, CoolifyServerRecord>,
): Promise<ParsedName[] | null> {
  const access = await projectCoolify(project, servers);
  if (!access) return null;
  const { token, ...target } = access;

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
    const app = await coolifyGet(`${target.base}/api/v1/applications/${target.uuid}`, token);
    if (app.status === 404) {
      const service = await coolifyGet(`${target.base}/api/v1/services/${target.uuid}`, token);
      if (!service.ok) return fail(coolifyAnswer(service.status));
      names = serviceDomains(await service.json());
    } else if (!app.ok) return fail(coolifyAnswer(app.status));
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
