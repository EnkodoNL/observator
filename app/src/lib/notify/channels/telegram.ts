// SPDX-License-Identifier: FSL-1.1-ALv2
import { z } from "zod";
import { escapeHtml, type Message } from "../message";
import { request, SendError, type ChannelDriver } from "./types";

function html(msg: Message): string {
  const lines = [`<b>${escapeHtml(msg.title)}</b>`, "", escapeHtml(msg.summary)];
  if (msg.items.length) lines.push("");
  for (const i of msg.items) {
    const sev = i.severity ? `<b>${i.severity.toUpperCase()}</b> ` : "";
    const title = i.url
      ? `<a href="${escapeHtml(i.url)}">${escapeHtml(i.title)}</a>`
      : `<b>${escapeHtml(i.title)}</b>`;
    lines.push(`• ${sev}${title}${i.detail ? ` ${escapeHtml(i.detail)}` : ""}`);
  }
  if (msg.more) lines.push(`• …and ${msg.more} more`);
  return lines.join("\n").slice(0, 4000);
}

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export const telegram: ChannelDriver<{ botToken: string; chatId: string }> = {
  type: "telegram",
  label: "Telegram",
  description: "Messages from your own bot, to a chat or group.",
  help: [
    "In Telegram, open @BotFather, send /newbot and copy the token it gives you.",
    "Start a chat with your new bot (or add it to a group) and send it any message.",
    "Paste the token below and press Detect chat to fill in the chat id.",
  ],
  fields: [
    {
      name: "botToken",
      label: "Bot token",
      kind: "password",
      placeholder: "123456:ABC-DEF…",
      required: true,
      secret: true,
    },
    { name: "chatId", label: "Chat id", kind: "text", placeholder: "-1001234567890", required: true },
  ],
  schema: z.object({
    botToken: z.string().regex(/^\d+:[\w-]{20,}$/, "This does not look like a bot token"),
    chatId: z.string().regex(/^-?\d+$|^@\w+$/, "A numeric chat id, or @channelname"),
  }),
  async send(msg, { botToken, chatId }) {
    const body = {
      chat_id: chatId,
      text: html(msg),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: msg.actions.length
        ? { inline_keyboard: [msg.actions.map((a) => ({ text: a.label, url: a.url }))] }
        : undefined,
    };
    try {
      await request(api(botToken, "sendMessage"), { json: body });
    } catch (err) {
      // Telegram rejects buttons pointing at localhost or plain IPs; resend with links in the text.
      if (!(err instanceof SendError) || !/button|url/i.test(err.message) || !msg.actions.length) throw err;
      const text = `${html(msg)}\n\n${msg.actions.map((a) => `${escapeHtml(a.label)}: ${escapeHtml(a.url)}`).join("\n")}`;
      await request(api(botToken, "sendMessage"), { json: { ...body, text, reply_markup: undefined } });
    }
  },
};

/** Recent chats the bot has seen, for the "Detect chat" helper in the settings form. */
export async function telegramChats(botToken: string): Promise<{ id: string; name: string; type: string }[]> {
  const res = await request(api(botToken, "getUpdates"), { method: "GET" });
  const data = (await res.json()) as {
    result?: {
      message?: { chat: TgChat };
      my_chat_member?: { chat: TgChat };
      channel_post?: { chat: TgChat };
    }[];
  };
  const chats = new Map<string, { id: string; name: string; type: string }>();
  for (const u of data.result ?? []) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
    if (!chat) continue;
    const name =
      chat.title ??
      ([chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || String(chat.id));
    chats.set(String(chat.id), { id: String(chat.id), name, type: chat.type });
  }
  return [...chats.values()];
}

interface TgChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}
