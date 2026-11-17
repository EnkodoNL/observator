// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { COOLIFY_FIELDS, projectCoolify, serverFor, serverMap } from "@/lib/coolify/access";
import { coolifyGet, coolifyRefusal } from "@/lib/coolify/client";
import { evaluateProject } from "@/lib/issues/evaluate";
import type { IssueEvent } from "@/lib/issues/events";
import { kvGet, kvSet } from "@/lib/kv";
import { publish } from "@/lib/notify/publish";
import { checkOutbound, OutboundError } from "@/lib/outbound";
import { adminPb, pbDate } from "@/lib/pb/admin";
import type { ProjectRecord } from "@/lib/pb/types";
import {
  deployState,
  deployStateKey,
  parseDeployments,
  type CoolifyDeployment,
  type DeployState,
} from "./state";

/*
 * For projects linked to a Coolify application (a server in Settings, or a Coolify deploy
 * webhook): whether something was deployed since the last report. Nothing deployed means the app runs what Observator has, however old; a deploy without
 * a report means the snippet, the key or the reporter is not working. Needs the token's read
 * permission, like the domains; Coolify services have no deployment history.
 */

export const deployStatus = (projectId: string) => kvGet<DeployState>(deployStateKey(projectId));

/** The last deploys of a project's Coolify application, or why they could not be read. */
export async function fetchDeployments(access: {
  base: string;
  uuid: string;
  token: string;
}): Promise<CoolifyDeployment[] | string> {
  try {
    await checkOutbound(access.base);
  } catch (err) {
    if (err instanceof OutboundError) return `refused: ${err.message}`;
    throw err;
  }
  try {
    const res = await coolifyGet(
      `${access.base}/api/v1/deployments/applications/${access.uuid}?take=10`,
      access.token,
    );
    if (res.status === 404)
      return "no deployment history in Coolify (a service, or no such application); the age check applies";
    if (!res.ok) return coolifyRefusal(res);
    return parseDeployments(await res.json());
  } catch (err) {
    return err instanceof Error && err.name === "TimeoutError" ? "Coolify timed out" : "Coolify unreachable";
  }
}

/**
 * Asks Coolify about every project with a deploy webhook, keeps the answer, and re-evaluates a
 * project whose answer changed, so a deploy without a report is announced within the hour.
 */
export async function checkDeploys(): Promise<IssueEvent[]> {
  const pb = await adminPb();
  // A uuid from a build that no server had yet (a server added later): look again.
  const unresolved = await pb.collection("projects").getFullList<ProjectRecord>({
    filter: 'coolifyUuid != "" && coolifyServer = "" && coolifyKind = ""',
    fields: "id,coolifyUuid",
  });
  for (const p of unresolved) {
    const server = await serverFor(p.coolifyUuid);
    if (server) await pb.collection("projects").update(p.id, { coolifyServer: server.id });
  }

  const projects = await pb.collection("projects").getFullList<ProjectRecord>({
    // Applications only: databases and services have no deployment history in Coolify.
    filter: '(deployWebhookUrl != "" || coolifyServer != "") && coolifyKind = ""',
    fields: `id,lastBuildAt,${COOLIFY_FIELDS}`,
  });
  const servers = await serverMap();
  const linked = (
    await Promise.all(
      projects.map(async (p) => {
        const access = await projectCoolify(p, servers);
        return access ? [{ project: p, access }] : [];
      }),
    )
  ).flat();
  // Projects on one Coolify resource (the services of a compose app) share its deploys.
  const byResource = new Map<string, typeof linked>();
  for (const l of linked) {
    const key = `${l.access.base}|${l.access.uuid}`;
    byResource.set(key, [...(byResource.get(key) ?? []), l]);
  }

  const events: IssueEvent[] = [];
  for (const group of byResource.values()) {
    const answer = await fetchDeployments(group[0].access);
    for (const { project } of group) {
      const lastBuildAt = pbDate(project.lastBuildAt);
      if (!lastBuildAt) continue;
      const siblings = group
        .filter((g) => g.project.id !== project.id)
        .flatMap((g) => pbDate(g.project.lastBuildAt) ?? []);
      const next: DeployState =
        typeof answer === "string"
          ? { checkedAt: new Date().toISOString(), lastDeployAt: null, unreported: null, error: answer }
          : {
              checkedAt: new Date().toISOString(),
              ...deployState(answer, lastBuildAt, siblings),
              error: null,
            };
      const previous = await deployStatus(project.id);
      await kvSet(deployStateKey(project.id), next);
      const changed =
        !previous ||
        previous.unreported?.uuid !== next.unreported?.uuid ||
        Boolean(previous.error) !== Boolean(next.error);
      if (changed) events.push(...(await evaluateProject(project.id)));
    }
  }
  await publish(events);
  return events;
}
