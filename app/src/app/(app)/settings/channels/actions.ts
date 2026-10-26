// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  type ChannelInput,
  type ChannelResult,
  getChannel,
  saveChannel,
  testChannel,
  testSavedChannel,
} from "@/lib/data/channels";
import { telegramChats } from "@/lib/notify/channels/telegram";
import { adminPb } from "@/lib/pb/admin";

export type { ChannelInput } from "@/lib/data/channels";
export type ActionResult = ChannelResult;

export async function saveChannelAction(raw: ChannelInput): Promise<ActionResult> {
  await requireUser();
  const result = await saveChannel(raw);
  if (result.ok) revalidatePath("/settings/channels");
  return result;
}

export async function testChannelAction(raw: ChannelInput): Promise<ActionResult> {
  await requireUser();
  return testChannel(raw);
}

export async function testSavedChannelAction(id: string): Promise<ActionResult> {
  await requireUser();
  return testSavedChannel(z.string().min(1).parse(id));
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
