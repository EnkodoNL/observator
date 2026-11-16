// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWriter } from "@/lib/auth/session";
import { coolifyBase } from "@/lib/coolify/client";
import {
  coolifyServerSchema,
  deleteServer,
  listServers,
  saveServer,
  serverAccess,
  testServer,
  type CoolifyServerInput,
} from "@/lib/coolify/servers";
import { SecretsKeyError } from "@/lib/secrets";

export type { CoolifyServerInput } from "@/lib/coolify/servers";

export async function saveServerAction(
  raw: CoolifyServerInput,
): Promise<{ ok?: boolean; error?: string; fieldErrors?: Record<string, string> }> {
  await requireWriter();
  const parsed = coolifyServerSchema.safeParse(raw);
  if (!parsed.success)
    return {
      fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
    };
  if (!parsed.data.id && !parsed.data.token) return { fieldErrors: { token: "Enter an API token" } };
  try {
    await saveServer(parsed.data);
  } catch (err) {
    if (err instanceof SecretsKeyError) return { error: err.message };
    throw err;
  }
  revalidatePath("/settings/coolify");
  return { ok: true };
}

/** Tests what is in the form; an empty token uses the stored one of that server. */
export async function testServerAction(raw: CoolifyServerInput): Promise<{ ok: boolean; message: string }> {
  await requireWriter();
  const base = coolifyBase(raw.url);
  if (!base) return { ok: false, message: "Enter the Coolify URL, such as https://coolify.example.com" };
  let token = raw.token.trim();
  if (!token && raw.id) {
    const stored = (await listServers()).find((s) => s.id === raw.id);
    token = (stored && serverAccess(stored)?.token) ?? "";
  }
  if (!token) return { ok: false, message: "Enter an API token" };
  const message = await testServer({ base, token });
  return { ok: message.startsWith("Connected"), message };
}

export async function deleteServerAction(id: string): Promise<void> {
  await requireWriter();
  await deleteServer(z.string().min(1).parse(id));
  revalidatePath("/settings/coolify");
}
