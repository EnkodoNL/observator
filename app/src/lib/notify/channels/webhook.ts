// SPDX-License-Identifier: FSL-1.1-ALv2
import { createHmac } from "node:crypto";
import { z } from "zod";
import { request, type ChannelDriver } from "./types";

/** Signature over "<timestamp>.<body>", so receivers can reject replays and tampering. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export const webhook: ChannelDriver<{ url: string; secret?: string }> = {
  type: "webhook",
  label: "Webhook",
  description: "JSON POST to any URL, optionally signed with HMAC-SHA256.",
  help: [
    'Headers: X-Observator-Event, X-Observator-Timestamp and, with a secret, X-Observator-Signature: sha256=HMAC(secret, timestamp + "." + body).',
  ],
  fields: [
    {
      name: "url",
      label: "URL",
      kind: "url",
      placeholder: "https://example.com/hooks/observator",
      required: true,
    },
    { name: "secret", label: "Signing secret", kind: "password", help: "Optional.", secret: true },
  ],
  schema: z.object({ url: z.url(), secret: z.string().optional() }),
  async send(msg, { url, secret }) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ ...msg, sentAt: new Date().toISOString() });
    await request(url, {
      body,
      headers: {
        "content-type": "application/json",
        "x-observator-event": msg.event,
        "x-observator-timestamp": timestamp,
        ...(secret ? { "x-observator-signature": signWebhook(secret, timestamp, body) } : {}),
      },
    });
  },
};
