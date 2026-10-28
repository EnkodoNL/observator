// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { kvGet, kvSet } from "@/lib/kv";
import { describeFetchError } from "@/lib/notify/channels/types";
import { WEBHOOK_TOKEN, WEBHOOK_URL } from "@/lib/data/projects";
import { checkOutbound, isRedirect, OutboundError } from "@/lib/outbound";
import { SecretsKeyError, unseal } from "@/lib/secrets";
import type { ProjectRecord } from "@/lib/pb/types";

export interface RedeployResult {
  at: string;
  ok: boolean;
  status?: number;
  message: string;
}

/** The stored webhook URL, masked for showing; "…" when it cannot be decrypted. */
export function maskedWebhook(project: Pick<ProjectRecord, "deployWebhookUrl">): string {
  try {
    return maskUrl(unseal(project.deployWebhookUrl, WEBHOOK_URL));
  } catch {
    return "…";
  }
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
    const url = unseal(project.deployWebhookUrl, WEBHOOK_URL);
    const token = unseal(project.deployWebhookToken, WEBHOOK_TOKEN);
    // Same guard as notification channels; only the status comes back, never the body.
    const target = await checkOutbound(url);
    const res = await fetch(target.href, {
      method: project.deployWebhookMethod || "POST",
      redirect: "manual",
      headers: {
        "user-agent": "observator",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    result = {
      at,
      ok: res.ok,
      status: res.status,
      message: res.ok
        ? "Deploy triggered"
        : `HTTP ${res.status}${isRedirect(res.status) ? ": redirects are not followed" : ""}`,
    };
  } catch (err) {
    result = {
      at,
      ok: false,
      message:
        err instanceof OutboundError || err instanceof SecretsKeyError
          ? `refused: ${err.message}`
          : describeFetchError(err, 20_000),
    };
  }
  await kvSet(`redeploy:${project.id}`, result);
  return result;
}

export const lastRedeploy = (projectId: string) => kvGet<RedeployResult>(`redeploy:${projectId}`);
