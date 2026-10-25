// SPDX-License-Identifier: FSL-1.1-ALv2
import { z } from "zod";
import { toPlainText, type Message } from "../message";
import { request, type ChannelDriver } from "./types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const link = (url: string, text: string) => `<${url}|${esc(text)}>`;

function blocks(msg: Message) {
  const items = msg.items.map((i) => {
    const sev = i.severity ? `*${i.severity.toUpperCase()}* ` : "";
    const title = i.url ? link(i.url, i.title) : `*${esc(i.title)}*`;
    return `• ${sev}${title}${i.detail ? ` ${esc(i.detail)}` : ""}`;
  });
  if (msg.more) items.push(`• …and ${msg.more} more`);
  return [
    { type: "header", text: { type: "plain_text", text: msg.title.slice(0, 150), emoji: false } },
    { type: "section", text: { type: "mrkdwn", text: esc(msg.summary).slice(0, 3000) } },
    ...(items.length
      ? [{ type: "section", text: { type: "mrkdwn", text: items.join("\n").slice(0, 3000) } }]
      : []),
    ...(msg.actions.length
      ? [
          {
            type: "actions",
            elements: msg.actions.map((a, i) => ({
              type: "button",
              text: { type: "plain_text", text: a.label },
              url: a.url,
              ...(i === 0 ? { style: "primary" } : {}),
            })),
          },
        ]
      : []),
  ];
}

export const slack: ChannelDriver<{ webhookUrl: string }> = {
  type: "slack",
  label: "Slack",
  description: "Incoming webhook into a channel.",
  help: [
    "Create a Slack app, enable Incoming Webhooks and add one for the channel you want. Paste its URL here.",
  ],
  fields: [
    {
      name: "webhookUrl",
      label: "Webhook URL",
      kind: "password",
      placeholder: "https://hooks.slack.com/services/…",
      required: true,
      secret: true,
    },
  ],
  schema: z.object({ webhookUrl: z.url() }),
  async send(msg, { webhookUrl }) {
    await request(webhookUrl, { json: { text: toPlainText(msg).slice(0, 3000), blocks: blocks(msg) } });
  },
};
