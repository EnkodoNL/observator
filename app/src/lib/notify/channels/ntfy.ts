// SPDX-License-Identifier: FSL-1.1-ALv2
import { z } from "zod";
import { toMarkdown, type MessageTone } from "../message";
import { request, type ChannelDriver } from "./types";

const PRIORITY: Record<MessageTone, number> = {
  critical: 5,
  high: 4,
  moderate: 3,
  low: 2,
  unknown: 3,
  info: 3,
  ok: 2,
};

export const ntfy: ChannelDriver<{ serverUrl: string; topic: string; token?: string }> = {
  type: "ntfy",
  label: "ntfy",
  description: "Push to a topic on ntfy.sh or your own ntfy server.",
  fields: [
    { name: "serverUrl", label: "Server URL", kind: "url", placeholder: "https://ntfy.sh", required: true },
    {
      name: "topic",
      label: "Topic",
      kind: "password",
      placeholder: "observator-a8f3",
      help: "Kept like a password: on a public server, anyone who knows the topic can read it.",
      required: true,
      secret: true,
    },
    {
      name: "token",
      label: "Access token",
      kind: "password",
      help: "Only for protected topics.",
      secret: true,
    },
  ],
  schema: z.object({
    serverUrl: z.url().transform((u) => u.replace(/\/+$/, "")),
    topic: z.string().regex(/^[\w-]{1,64}$/, "Letters, digits, - and _ only"),
    token: z.string().optional(),
  }),
  async send(msg, { serverUrl, topic, token }) {
    await request(serverUrl, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      json: {
        topic,
        title: msg.title,
        message: toMarkdown(msg, { links: false }),
        markdown: true,
        priority: PRIORITY[msg.tone],
        tags: [
          msg.tone === "ok" ? "white_check_mark" : msg.tone === "info" ? "information_source" : "warning",
        ],
        click: msg.actions[0]?.url,
        actions: msg.actions.slice(0, 3).map((a) => ({ action: "view", label: a.label, url: a.url })),
      },
    });
  },
};
