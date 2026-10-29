// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWriter } from "@/lib/auth/session";
import { checkDomains } from "@/lib/domains/check";
import { addName, removeDomain, removeHost, setHostProject, updateDomain } from "@/lib/domains/data";
import { parseName } from "@/lib/domains/names";

type Result = { ok?: boolean; error?: string };

const settingsSchema = z.object({
  note: z.string().trim().max(1000).default(""),
  remindDays: z.coerce.number().int().min(0).max(3650).default(0),
  /** yyyy-mm-dd, or empty for none. */
  manualExpiresAt: z.union([z.literal(""), z.iso.date()]).default(""),
});

const addSchema = settingsSchema.extend({
  name: z.string().trim().min(1, "Enter a domain or hostname.").max(300),
  project: z.string().max(30).default(""),
  checkCert: z.boolean().default(true),
});

export type AddDomainInput = z.input<typeof addSchema>;
export type DomainSettingsInput = z.input<typeof settingsSchema>;

const done = (): Result => {
  revalidatePath("/", "layout");
  return { ok: true };
};

/** Watches a name, saves its settings and checks it right away (a few seconds). */
export async function addDomainAction(input: AddDomainInput): Promise<Result> {
  await requireWriter();
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the fields." };
  const { name, project, checkCert, ...settings } = parsed.data;
  const parsedName = parseName(name);
  if (!parsedName)
    return {
      error: `"${name}" is not a domain or hostname (an IP address or a bare suffix like co.uk is not).`,
    };
  const { domain } = await addName({ name: parsedName, checkCert, project: project || undefined });
  if (settings.note || settings.remindDays || settings.manualExpiresAt)
    await updateDomain(domain.id, settings);
  await checkDomains({ domainId: domain.id });
  return done();
}

export async function updateDomainAction(id: string, input: DomainSettingsInput): Promise<Result> {
  await requireWriter();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the fields." };
  await updateDomain(z.string().min(1).parse(id), parsed.data);
  // A new date or reminder can change the phase at once.
  await checkDomains({ domainId: id });
  return done();
}

export async function checkDomainAction(id: string): Promise<Result> {
  await requireWriter();
  await checkDomains({ domainId: z.string().min(1).parse(id) });
  return done();
}

export async function setHostProjectAction(hostId: string, projectId: string): Promise<Result> {
  await requireWriter();
  await setHostProject(z.string().min(1).parse(hostId), z.string().max(30).parse(projectId));
  return done();
}

export async function removeHostAction(id: string): Promise<Result> {
  await requireWriter();
  await removeHost(z.string().min(1).parse(id));
  return done();
}

export async function removeDomainAction(id: string): Promise<Result> {
  await requireWriter();
  await removeDomain(z.string().min(1).parse(id));
  return done();
}
