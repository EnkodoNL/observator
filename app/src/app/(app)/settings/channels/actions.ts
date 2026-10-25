// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getChannel, mergeConfig } from "@/lib/data/channels";
import { env } from "@/lib/env";
import { EVENT_TYPES } from "@/lib/issues/events";
import { driverFor } from "@/lib/notify/channels";
import { telegramChats } from "@/lib/notify/channels/telegram";
import { testMessage } from "@/lib/notify/render";
import { adminPb } from "@/lib/pb/admin";
import { SEVERITIES, type ChannelType } from "@/lib/pb/types";

const CHANNEL_TYPES = [
  "slack",
  "telegram",
  "discord",
  "email",
  "ntfy",
  "gotify",
  "pushover",
  "apprise",
  "webhook",
] as const;

const inputSchema = z.object({
  id: z.string().optional(),
  type: z.enum(CHANNEL_TYPES),
  name: z.string().trim().min(1, "Give the channel a name").max(100),
  enabled: z.boolean(),
  minSeverity: z.enum(SEVERITIES as [string, ...string[]]),
  events: z.array(z.enum(EVENT_TYPES)).min(1, "Pick at least one event"),
  projects: z.array(z.string()),
  config: z.record(z.string(), z.string()),
});

export type ChannelInput = z.infer<typeof inputSchema>;

export interface ActionResult {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: string;
}

async function resolveConfig(input: ChannelInput) {
  const previous = input.id ? (await getChannel(input.id)).config : null;
  return mergeConfig(input.type as ChannelType, input.config, previous);
}

export async function saveChannelAction(raw: ChannelInput): Promise<ActionResult> {
  await requireUser();
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { error: "Please check the highlighted fields.", fieldErrors };
  }
  const input = parsed.data;
  const merged = await resolveConfig(input);
  if (!merged.ok) return { error: "Please check the highlighted fields.", fieldErrors: merged.errors };

  const pb = await adminPb();
  const data = {
    type: input.type,
    name: input.name,
    enabled: input.enabled,
    minSeverity: input.minSeverity,
    events: input.events.length === EVENT_TYPES.length ? [] : input.events,
    projects: input.projects,
    config: merged.config,
  };
  const record = input.id
    ? await pb.collection("channels").update(input.id, data)
    : await pb.collection("channels").create(data);
  revalidatePath("/settings/channels");
  return { ok: true, id: record.id };
}

export async function testChannelAction(raw: ChannelInput): Promise<ActionResult> {
  await requireUser();
  const parsed = inputSchema.safeParse({ ...raw, name: raw.name || "test" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const merged = await resolveConfig(parsed.data);
  if (!merged.ok) return { error: "Please check the highlighted fields.", fieldErrors: merged.errors };
  try {
    await driverFor(parsed.data.type as ChannelType).send(testMessage(env().APP_URL), merged.config);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function testSavedChannelAction(id: string): Promise<ActionResult> {
  await requireUser();
  const channel = await getChannel(z.string().min(1).parse(id));
  try {
    await driverFor(channel.type).send(
      testMessage(env().APP_URL),
      (channel.config ?? {}) as Record<string, string>,
    );
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function toggleChannelAction(id: string, enabled: boolean): Promise<void> {
  await requireUser();
  const pb = await adminPb();
  await pb.collection("channels").update(z.string().min(1).parse(id), { enabled: Boolean(enabled) });
  revalidatePath("/settings/channels");
}

export async function deleteChannelAction(id: string): Promise<void> {
  await requireUser();
  const pb = await adminPb();
  await pb.collection("channels").delete(z.string().min(1).parse(id));
  revalidatePath("/settings/channels");
}

/** Lists chats the bot has seen; uses the stored token when the field is left empty. */
export async function detectTelegramAction(
  botToken: string,
  channelId?: string,
): Promise<{ chats?: { id: string; name: string; type: string }[]; error?: string }> {
  await requireUser();
  let token = botToken.trim();
  if (!token && channelId) token = String((await getChannel(channelId)).config?.botToken ?? "");
  if (!token) return { error: "Enter the bot token first." };
  try {
    const chats = await telegramChats(token);
    return chats.length ? { chats } : { error: "No chats yet. Send your bot a message, then try again." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
