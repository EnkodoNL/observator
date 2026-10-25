// SPDX-License-Identifier: FSL-1.1-ALv2
import { z } from "zod";
import { toMarkdown, type MessageTone } from "../message";
import { request, type ChannelDriver } from "./types";

const PRIORITY: Record<MessageTone, number> = {
  critical: 9,
  high: 7,
  moderate: 5,
  low: 3,
  unknown: 5,
  info: 4,
  ok: 3,
};

export const gotify: ChannelDriver<{ serverUrl: string; appToken: string }> = {
  type: "gotify",
  label: "Gotify",
  description: "Self-hosted push via a Gotify application token.",
  fields: [
    {
      name: "serverUrl",
      label: "Server URL",
      kind: "url",
      placeholder: "https://gotify.example.com",
      required: true,
    },
    { name: "appToken", label: "Application token", kind: "password", required: true, secret: true },
  ],
  schema: z.object({
    serverUrl: z.url().transform((u) => u.replace(/\/+$/, "")),
    appToken: z.string().min(1),
  }),
  async send(msg, { serverUrl, appToken }) {
    await request(`${serverUrl}/message`, {
      headers: { "x-gotify-key": appToken },
      json: {
        title: msg.title,
        message: toMarkdown(msg),
        priority: PRIORITY[msg.tone],
        extras: {
          "client::display": { contentType: "text/markdown" },
          ...(msg.actions[0] ? { "client::notification": { click: { url: msg.actions[0].url } } } : {}),
        },
      },
    });
  },
};
