// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWriter } from "@/lib/auth/session";
import { createIngestKey, revokeIngestKey, updateSharedKey } from "@/lib/data/ingest-keys";
import type { AllowEntry } from "@/lib/ingest/allowlist";
import { createProject, deleteProject, rotateApiKey } from "@/lib/data/projects";
import { type FormState, formObject, zodState } from "@/lib/forms";

export interface CreatedProject extends FormState {
  project?: { name: string; slug: string };
  apiKey?: string;
}

const nameSchema = z.object({ name: z.string().trim().min(1, "Give the project a name.").max(100) });

export async function createProjectAction(_prev: CreatedProject, data: FormData): Promise<CreatedProject> {
  await requireWriter();
  const values = formObject(data);
  const parsed = nameSchema.safeParse(values);
  if (!parsed.success) return zodState(parsed.error, values);
  const { project, apiKey } = await createProject(parsed.data.name);
  revalidatePath("/", "layout");
  return { ok: true, project: { name: project.name, slug: project.slug }, apiKey };
}

export async function rotateKeyAction(projectId: string): Promise<{ apiKey: string }> {
  await requireWriter();
  const apiKey = await rotateApiKey(z.string().min(1).parse(projectId));
  revalidatePath("/", "layout");
  return { apiKey };
}

export async function deleteProjectAction(projectId: string): Promise<void> {
  await requireWriter();
  await deleteProject(z.string().min(1).parse(projectId));
  revalidatePath("/", "layout");
}

export async function createSharedKeyAction(
  name: string,
  splitByIp: boolean,
): Promise<{ key?: string; error?: string }> {
  const { user } = await requireWriter();
  const parsed = z.string().trim().min(1, "Give the key a name").max(100).safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { key } = await createIngestKey(parsed.data, Boolean(splitByIp), user.id);
  revalidatePath("/settings/projects");
  return { key };
}

/** Saves a shared key's IP allowlist: one address or range per line. */
export async function updateAllowlistAction(
  id: string,
  text: string,
): Promise<{ entries?: AllowEntry[]; error?: string }> {
  await requireWriter();
  const res = await updateSharedKey(z.string().min(1).parse(id), {
    allowlist: z.string().max(20_000).parse(text),
  });
  if (res.error) return { error: res.error };
  revalidatePath("/settings/projects");
  return { entries: res.key?.allowedIps ?? [] };
}

export async function revokeSharedKeyAction(id: string): Promise<void> {
  await requireWriter();
  await revokeIngestKey(z.string().min(1).parse(id));
  revalidatePath("/", "layout");
}
