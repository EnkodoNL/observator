// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createIgnore, deleteIgnore, ignoreSchema, type IgnoreInput } from "@/lib/data/ignores";
import {
  projectSettingsSchema,
  saveProjectSettings,
  setLabels,
  type ProjectSettings,
} from "@/lib/data/projects";
import { parseLabels } from "@/lib/labels";
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

export async function saveProjectSettingsAction(
  projectId: string,
  input: ProjectSettings,
): Promise<{ ok?: boolean; error?: string; fieldErrors?: Record<string, string> }> {
  await requireUser();
  const parsed = projectSettingsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);
  const project = await saveProjectSettings(z.string().min(1).parse(projectId), parsed.data);
  revalidatePath(`/projects/${project.slug}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateLabelsAction(
  projectId: string,
  text: string,
): Promise<{ ok?: boolean; error?: string }> {
  await requireUser();
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
  const { user } = await requireUser();
  const parsed = ignoreSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);
  await createIgnore(parsed.data, user.id);
  return { ok: true };
}

export async function unignoreAction(ignoreId: string): Promise<void> {
  await requireUser();
  await deleteIgnore(z.string().min(1).parse(ignoreId));
}

function invalid(issues: z.core.$ZodIssue[]) {
  const fieldErrors: Record<string, string> = {};
  for (const i of issues) fieldErrors[i.path.join(".")] ??= i.message;
  return { error: "Please check the highlighted fields.", fieldErrors };
}
