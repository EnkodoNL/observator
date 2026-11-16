// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { WEBHOOK_TOKEN, WEBHOOK_URL } from "@/lib/data/projects";
import { adminPb } from "@/lib/pb/admin";
import type { CoolifyServerRecord, ProjectRecord } from "@/lib/pb/types";
import { SecretsKeyError, unseal } from "@/lib/secrets";
import { COOLIFY_UUID, coolifyTarget, hasApplication, type CoolifyAccess } from "./client";
import { listServers, serverAccess } from "./servers";

export type ProjectCoolify = CoolifyAccess & { via: "link" | "webhook" };

type Linkable = Pick<
  ProjectRecord,
  "coolifyServer" | "coolifyUuid" | "deployWebhookUrl" | "deployWebhookToken"
>;

/** The fields a query needs for projectCoolify. */
export const COOLIFY_FIELDS = "coolifyServer,coolifyUuid,coolifySource,deployWebhookUrl,deployWebhookToken";

/** The Coolify server and application behind a project's deploy webhook, if it is a Coolify one. */
export function webhookAccess(project: Pick<ProjectRecord, "deployWebhookUrl" | "deployWebhookToken">) {
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
  return target && token ? { ...target, token } : null;
}

/**
 * How Observator reaches a project's Coolify application: through the server it is linked to,
 * otherwise through its deploy webhook. `servers` saves the lookups when called for many projects.
 */
export async function projectCoolify(
  project: Linkable,
  servers?: Map<string, CoolifyServerRecord>,
): Promise<ProjectCoolify | null> {
  if (project.coolifyServer && project.coolifyUuid) {
    const server =
      servers?.get(project.coolifyServer) ??
      (await (
        await adminPb()
      )
        .collection("coolify_servers")
        .getOne<CoolifyServerRecord>(project.coolifyServer)
        .catch(() => null));
    const access = server ? serverAccess(server) : null;
    if (access) return { ...access, uuid: project.coolifyUuid, via: "link" };
  }
  const webhook = webhookAccess(project);
  return webhook ? { ...webhook, via: "webhook" } : null;
}

export const serverMap = async () => new Map((await listServers()).map((s) => [s.id, s]));

/** The configured server that has this application, asked one by one; null when none does. */
export async function serverFor(uuid: string): Promise<CoolifyServerRecord | null> {
  for (const server of await listServers()) {
    const access = serverAccess(server);
    if (access && (await hasApplication(access, uuid))) return server;
  }
  return null;
}

/**
 * Links a project to a Coolify application, or unlinks it with null. The server is looked up
 * now; when none has it yet, the uuid is kept and the hourly check tries again.
 */
export async function linkProject(
  projectId: string,
  uuid: string | null,
  source: "build" | "picked" | "self",
): Promise<void> {
  const pb = await adminPb();
  if (!uuid) {
    await pb
      .collection("projects")
      .update(projectId, { coolifyServer: "", coolifyUuid: "", coolifySource: "" });
    return;
  }
  if (!COOLIFY_UUID.test(uuid)) throw new Error("not a Coolify uuid");
  const server = await serverFor(uuid);
  await pb
    .collection("projects")
    .update(projectId, { coolifyServer: server?.id ?? "", coolifyUuid: uuid, coolifySource: source });
}
