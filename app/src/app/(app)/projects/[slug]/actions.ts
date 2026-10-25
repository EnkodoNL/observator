// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { triggerRedeploy, type RedeployResult } from "@/lib/deploy";
import { adminPb } from "@/lib/pb/admin";
import type { ProjectRecord } from "@/lib/pb/types";

export async function redeployAction(projectId: string): Promise<RedeployResult> {
  await requireUser();
  const pb = await adminPb();
  const project = await pb.collection("projects").getOne<ProjectRecord>(z.string().min(1).parse(projectId));
  const result = await triggerRedeploy(project);
  revalidatePath(`/projects/${project.slug}`);
  return result;
}

const settingsSchema = z.object({
  name: z.string().trim().min(1, "Give the project a name").max(100),
  deployWebhookUrl: z.union([z.literal(""), z.url("Enter a full URL, including https://")]),
  deployWebhookMethod: z.enum(["GET", "POST"]),
  deployWebhookToken: z.string().max(1024),
  clearWebhook: z.boolean(),
});

export async function saveProjectSettingsAction(
  projectId: string,
  input: z.infer<typeof settingsSchema>,
): Promise<{ ok?: boolean; error?: string; fieldErrors?: Record<string, string> }> {
  await requireUser();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { error: "Please check the highlighted fields.", fieldErrors };
  }
  const { name, deployWebhookUrl, deployWebhookMethod, deployWebhookToken, clearWebhook } = parsed.data;
  const pb = await adminPb();
  const id = z.string().min(1).parse(projectId);
  // Empty URL or token fields keep the stored values: they are secrets the browser never sees.
  const data: Partial<ProjectRecord> = { name, deployWebhookMethod };
  if (clearWebhook) Object.assign(data, { deployWebhookUrl: "", deployWebhookToken: "" });
  else {
    if (deployWebhookUrl) data.deployWebhookUrl = deployWebhookUrl;
    if (deployWebhookToken) data.deployWebhookToken = deployWebhookToken;
  }
  const project = await pb.collection("projects").update<ProjectRecord>(id, data);
  revalidatePath(`/projects/${project.slug}`);
  revalidatePath("/", "layout");
  return { ok: true };
}
