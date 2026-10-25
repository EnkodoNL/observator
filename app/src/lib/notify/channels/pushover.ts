// SPDX-License-Identifier: FSL-1.1-ALv2
import { z } from "zod";
import { escapeHtml, type Message, type MessageTone } from "../message";
import { request, type ChannelDriver } from "./types";

const PRIORITY: Record<MessageTone, number> = {
  critical: 1,
  high: 0,
  moderate: 0,
  low: -1,
  unknown: 0,
  info: -1,
  ok: -1,
};

function html(msg: Message): string {
  const lines = [escapeHtml(msg.summary)];
  for (const i of msg.items) {
    lines.push(
      `• ${i.severity ? `<b>${i.severity.toUpperCase()}</b> ` : ""}${escapeHtml(i.title)}${i.detail ? `: ${escapeHtml(i.detail)}` : ""}`,
    );
  }
  if (msg.more) lines.push(`• …and ${msg.more} more`);
  const text = lines.join("\n");
  return text.length > 1000 ? `${text.slice(0, 990)}…` : text;
}

export const pushover: ChannelDriver<{ userKey: string; apiToken: string; device?: string }> = {
  type: "pushover",
  label: "Pushover",
  description: "Push notifications to phones and desktops.",
  help: ["Create an application at pushover.net/apps for the API token; the user key is on your dashboard."],
  fields: [
    { name: "userKey", label: "User key", kind: "password", required: true, secret: true },
    { name: "apiToken", label: "API token", kind: "password", required: true, secret: true },
    { name: "device", label: "Device", kind: "text", help: "Optional; leave empty for all devices." },
  ],
  schema: z.object({
    userKey: z.string().min(1),
    apiToken: z.string().min(1),
    device: z.string().optional(),
  }),
  async send(msg, { userKey, apiToken, device }) {
    await request("https://api.pushover.net/1/messages.json", {
      json: {
        token: apiToken,
        user: userKey,
        device: device || undefined,
        title: msg.title.slice(0, 250),
        message: html(msg),
        html: 1,
        priority: PRIORITY[msg.tone],
        url: msg.actions[0]?.url,
        url_title: msg.actions[0]?.label,
      },
    });
  },
};
