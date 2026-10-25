// SPDX-License-Identifier: FSL-1.1-ALv2
import { z } from "zod";
import { TONE_COLOR, toMarkdown } from "../message";
import { request, type ChannelDriver } from "./types";

export const discord: ChannelDriver<{ webhookUrl: string }> = {
  type: "discord",
  label: "Discord",
  description: "Channel webhook.",
  help: ["Channel settings → Integrations → Webhooks → New Webhook, then copy its URL."],
  fields: [
    {
      name: "webhookUrl",
      label: "Webhook URL",
      kind: "password",
      placeholder: "https://discord.com/api/webhooks/…",
      required: true,
      secret: true,
    },
  ],
  schema: z.object({ webhookUrl: z.url() }),
  async send(msg, { webhookUrl }) {
    await request(webhookUrl, {
      json: {
        username: "Observator",
        allowed_mentions: { parse: [] },
        embeds: [
          {
            title: msg.title.slice(0, 256),
            url: msg.actions[0]?.url,
            description: toMarkdown(msg).slice(0, 4000),
            color: parseInt(TONE_COLOR[msg.tone].slice(1), 16),
          },
        ],
      },
    });
  },
};
