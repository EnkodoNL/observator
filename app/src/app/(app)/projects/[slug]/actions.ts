// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWriter } from "@/lib/auth/session";
import { createIgnore, deleteIgnore, ignoreSchema, type IgnoreInput } from "@/lib/data/ignores";
import {
  projectSettingsSchema,
  saveProjectSettings,
  setLabels,
  type ProjectSettings,
} from "@/lib/data/projects";
import { parseLabels } from "@/lib/labels";
import { triggerRedeploy, type RedeployResult } from "@/lib/deploy";
import { linkProject } from "@/lib/coolify/access";
import { COOLIFY_UUID, listApplications } from "@/lib/coolify/client";
import { listServers, serverAccess } from "@/lib/coolify/servers";
import { adminPb } from "@/lib/pb/admin";
import { SecretsKeyError } from "@/lib/secrets";
import type { ProjectRecord } from "@/lib/pb/types";

export async function redeployAction(projectId: string): Promise<RedeployResult> {
  await requireWriter();
  const pb = await adminPb();
  const project = await pb.collection("projects").getOne<ProjectRecord>(z.string().min(1).parse(projectId));
  const result = await triggerRedeploy(project);
  revalidatePath(`/projects/${project.slug}`);
  return result;
}

/** Every application the configured Coolify servers can show, for picking a project's own. */
export async function coolifyApplicationsAction(): Promise<{
  apps: { serverName: string; uuid: string; name: string; domains: string[]; buildPack: string }[];
  errors: string[];
}> {
  await requireWriter();
  const apps: Awaited<ReturnType<typeof coolifyApplicationsAction>>["apps"] = [];
  const errors: string[] = [];
  for (const server of await listServers()) {
    const access = serverAccess(server);
    if (!access) {
      errors.push(`${server.name}: no token, or SECRETS_KEY changed`);
      continue;
    }
    const list = await listApplications(access);
    if ("error" in list) errors.push(`${server.name}: ${list.error}`);
    else apps.push(...list.map((a) => ({ serverName: server.name, ...a })));
  }
  return { apps: apps.sort((a, b) => a.name.localeCompare(b.name)), errors };
}

/** Links the project to a Coolify application by hand, or unlinks it (null). */
export async function linkCoolifyAction(projectId: string, uuid: string | null): Promise<{ error?: string }> {
  await requireWriter();
  const pb = await adminPb();
  const project = await pb.collection("projects").getOne<ProjectRecord>(z.string().min(1).parse(projectId));
  if (project.coolifyKind)
    return { error: "This project is a Coolify resource; its link comes from the sync." };
  const parsed = z.string().regex(COOLIFY_UUID).nullable().safeParse(uuid);
  if (!parsed.success) return { error: "Not a Coolify application" };
  await linkProject(project.id, parsed.data, "picked");
  revalidatePath(`/projects/${project.slug}`);
  return {};
}

export async function saveProjectSettingsAction(
  projectId: string,
  input: ProjectSettings,
): Promise<{ ok?: boolean; error?: string; fieldErrors?: Record<string, string> }> {
  await requireWriter();
  const parsed = projectSettingsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);
  let project: ProjectRecord;
  try {
    project = await saveProjectSettings(z.string().min(1).parse(projectId), parsed.data);
  } catch (err) {
    if (err instanceof SecretsKeyError) return { error: `Not saved: ${err.message}.` };
    throw err;
  }
  revalidatePath(`/projects/${project.slug}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateLabelsAction(
  projectId: string,
  text: string,
): Promise<{ ok?: boolean; error?: string }> {
  await requireWriter();
  const { labels, invalid } = parseLabels(z.string().max(2000).parse(text));
  if (invalid.length) return { error: `Not a label: ${invalid.join(", ")}` };
  const project = await setLabels(z.string().min(1).parse(projectId), labels);
  revalidatePath(`/projects/${project.slug}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function ignoreAction(
  input: IgnoreInput,
): Promise<{ ok?: boolean; error?: string; fieldErrors?: Record<string, string> }> {
  const { user } = await requireWriter();
  const parsed = ignoreSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);
  await createIgnore(parsed.data, user.id);
  return { ok: true };
}

export async function unignoreAction(ignoreId: string): Promise<void> {
  await requireWriter();
  await deleteIgnore(z.string().min(1).parse(ignoreId));
}

function invalid(issues: z.core.$ZodIssue[]) {
  const fieldErrors: Record<string, string> = {};
  for (const i of issues) fieldErrors[i.path.join(".")] ??= i.message;
  return { error: "Please check the highlighted fields.", fieldErrors };
}
