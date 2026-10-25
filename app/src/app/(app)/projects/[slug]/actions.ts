// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { triggerRedeploy, type RedeployResult } from "@/lib/deploy";
import { evaluateAll, evaluateProject } from "@/lib/issues/evaluate";
import { publish } from "@/lib/notify/publish";
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

const ignoreSchema = z.object({
  projectId: z.string().min(1),
  scope: z.enum(["project", "all"]),
  match: z.enum(["advisory", "package"]),
  osvId: z.string().max(128),
  pkg: z.string().max(214),
  reason: z.string().trim().min(3, "Say why, for whoever looks at this later").max(1000),
  expiresAt: z.union([z.literal(""), z.iso.date("Pick a date")]),
});

export async function ignoreAction(
  input: z.infer<typeof ignoreSchema>,
): Promise<{ ok?: boolean; error?: string; fieldErrors?: Record<string, string> }> {
  const { user } = await requireUser();
  const parsed = ignoreSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { error: "Please check the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;
  const pb = await adminPb();
  await pb.collection("ignores").create({
    project: v.scope === "project" ? v.projectId : "",
    osvId: v.match === "advisory" ? v.osvId : "",
    package: v.match === "package" ? v.pkg : "",
    reason: v.reason,
    expiresAt: v.expiresAt ? `${v.expiresAt} 23:59:59.000Z` : "",
    createdBy: user.id,
  });
  await reevaluate(v.scope === "project" ? v.projectId : null);
  return { ok: true };
}

export async function unignoreAction(ignoreId: string): Promise<void> {
  await requireUser();
  const pb = await adminPb();
  const ignore = await pb
    .collection("ignores")
    .getOne<{ id: string; project: string }>(z.string().min(1).parse(ignoreId));
  await pb.collection("ignores").delete(ignore.id);
  await reevaluate(ignore.project || null);
}

/** Applies ignore changes right away; lifting one can produce a notification again. */
async function reevaluate(projectId: string | null): Promise<void> {
  const events = projectId ? await evaluateProject(projectId) : await evaluateAll();
  await publish(events);
  revalidatePath("/", "layout");
}
