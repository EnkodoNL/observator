// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { kvGet, kvSet } from "@/lib/kv";
import { describeFetchError } from "@/lib/notify/channels/types";
import type { ProjectRecord } from "@/lib/pb/types";

export interface RedeployResult {
  at: string;
  ok: boolean;
  status?: number;
  message: string;
}

/** Shows enough of a webhook URL to recognise it, without the token that is often in it. */
export function maskUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const first = u.pathname.split("/").filter(Boolean)[0];
    return `${u.origin}/${first ? `${first}/` : ""}…`;
  } catch {
    return "…";
  }
}

/**
 * Calls the project's deploy webhook: Coolify (GET with a bearer token), Dokploy and Portainer
 * (POST to a URL that contains the token), or anything else that takes a plain request.
 */
export async function triggerRedeploy(project: ProjectRecord): Promise<RedeployResult> {
  if (!project.deployWebhookUrl) throw new Error("No deploy webhook configured");
  const at = new Date().toISOString();
  let result: RedeployResult;
  try {
    const res = await fetch(project.deployWebhookUrl, {
      method: project.deployWebhookMethod || "POST",
      headers: {
        "user-agent": "observator",
        ...(project.deployWebhookToken ? { authorization: `Bearer ${project.deployWebhookToken}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.text().catch(() => "")).slice(0, 200).trim();
    result = {
      at,
      ok: res.ok,
      status: res.status,
      message: res.ok ? "Deploy triggered" : `HTTP ${res.status}${body ? `: ${body}` : ""}`,
    };
  } catch (err) {
    result = { at, ok: false, message: describeFetchError(err, 20_000) };
  }
  await kvSet(`redeploy:${project.id}`, result);
  return result;
}

export const lastRedeploy = (projectId: string) => kvGet<RedeployResult>(`redeploy:${projectId}`);
