// SPDX-License-Identifier: FSL-1.1-ALv2
import { z } from "zod";
import { toMarkdown, type MessageTone } from "../message";
import { request, type ChannelDriver } from "./types";

const TYPE: Record<MessageTone, string> = {
  critical: "failure",
  high: "failure",
  moderate: "warning",
  low: "info",
  unknown: "info",
  info: "info",
  ok: "success",
};

export const apprise: ChannelDriver<{ serverUrl: string; key?: string; urls?: string; tag?: string }> = {
  type: "apprise",
  label: "Apprise API",
  description: "One channel for the 100+ services Apprise supports, through your Apprise API server.",
  help: ["Use a configuration key stored on the Apprise server, or give Apprise URLs directly (stateless)."],
  fields: [
    {
      name: "serverUrl",
      label: "Apprise API URL",
      kind: "url",
      placeholder: "http://apprise:8000",
      required: true,
    },
    {
      name: "key",
      label: "Config key",
      kind: "text",
      placeholder: "observator",
      help: "Stored configuration to notify.",
    },
    {
      name: "urls",
      label: "Apprise URLs",
      kind: "password",
      placeholder: "mailto://… tgram://…",
      help: "Instead of a key: space or comma separated Apprise URLs.",
      secret: true,
    },
    { name: "tag", label: "Tag", kind: "text", help: "Optional tag filter for stored configurations." },
  ],
  schema: z
    .object({
      serverUrl: z.url().transform((u) => u.replace(/\/+$/, "")),
      key: z
        .string()
        .regex(/^[\w-]*$/, "Letters, digits, - and _ only")
        .optional(),
      urls: z.string().optional(),
      tag: z.string().optional(),
    })
    .refine((c) => Boolean(c.key) !== Boolean(c.urls), {
      message: "Set either a config key or Apprise URLs",
      path: ["key"],
    }),
  async send(msg, { serverUrl, key, urls, tag }) {
    const body = {
      title: msg.title,
      body: toMarkdown(msg),
      type: TYPE[msg.tone],
      format: "markdown",
      ...(tag ? { tag } : {}),
    };
    if (key) await request(`${serverUrl}/notify/${encodeURIComponent(key)}`, { json: body });
    else await request(`${serverUrl}/notify`, { json: { ...body, urls } });
  },
};
