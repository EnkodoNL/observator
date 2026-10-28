// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { EVENT_TYPES, type EventType } from "@/lib/issues/events";
import { driverFor, secretFields } from "@/lib/notify/channels";
import { testMessage } from "@/lib/notify/render";
import { adminPb } from "@/lib/pb/admin";
import {
  SEVERITIES,
  type ChannelRecord,
  type ChannelType,
  type NotificationRecord,
  type Severity,
} from "@/lib/pb/types";
import { seal, SecretsKeyError, unseal } from "@/lib/secrets";
import { maskUrlSecrets, urlOrigin } from "@/lib/url";

export const CHANNEL_TYPES = [
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

export const channelInputSchema = z.object({
  id: z.string().optional(),
  type: z.enum(CHANNEL_TYPES),
  name: z.string().trim().min(1, "Give the channel a name").max(100),
  enabled: z.boolean(),
  minSeverity: z.enum(SEVERITIES as [string, ...string[]]),
  events: z.array(z.enum(EVENT_TYPES)).min(1, "Pick at least one event"),
  projects: z.array(z.string()),
  config: z.record(z.string(), z.string()),
});

export type ChannelInput = z.infer<typeof channelInputSchema>;

export interface ChannelResult {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: string;
}

const invalid = (issues: z.core.$ZodIssue[]): ChannelResult => {
  const fieldErrors: Record<string, string> = {};
  for (const i of issues) fieldErrors[i.path.join(".")] ??= i.message;
  return { error: "Please check the highlighted fields.", fieldErrors };
};

const secretContext = (type: ChannelType, field: string) => `channels.${type}.${field}`;

/** A channel's config with its secret fields decrypted, ready for the driver. */
export function openConfig(channel: Pick<ChannelRecord, "type" | "config">): Record<string, string> {
  const config = { ...((channel.config ?? {}) as Record<string, string>) };
  for (const field of secretFields(channel.type))
    if (typeof config[field] === "string")
      config[field] = unseal(config[field], secretContext(channel.type, field));
  return config;
}

/** The config as stored: secret fields encrypted (lib/secrets). */
function sealConfig(type: ChannelType, config: Record<string, string>): Record<string, string> {
  const out = { ...config };
  for (const field of secretFields(type))
    if (out[field]) out[field] = seal(out[field], secretContext(type, field));
  return out;
}

async function resolveConfig(input: ChannelInput) {
  const previous = input.id ? openConfig(await getChannel(input.id)) : null;
  return mergeConfig(input.type as ChannelType, input.config, previous);
}

/** Creates or updates a channel. Empty secret fields keep the stored secret. */
export async function saveChannel(raw: unknown): Promise<ChannelResult> {
  const parsed = channelInputSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error.issues);
  const input = parsed.data;
  const merged = await resolveConfig(input);
  if (!merged.ok) return { error: "Please check the highlighted fields.", fieldErrors: merged.errors };
  let config: Record<string, string>;
  try {
    config = sealConfig(input.type as ChannelType, merged.config);
  } catch (err) {
    if (err instanceof SecretsKeyError) return { error: `Not saved: ${err.message}.` };
    throw err;
  }
  const pb = await adminPb();
  const data = {
    type: input.type,
    name: input.name,
    enabled: input.enabled,
    minSeverity: input.minSeverity,
    events: input.events.length === EVENT_TYPES.length ? [] : input.events,
    projects: input.projects,
    config,
  };
  const record = input.id
    ? await pb.collection("channels").update(input.id, data)
    : await pb.collection("channels").create(data);
  return { ok: true, id: record.id };
}

/** Sends a test message with unsaved settings (stored secrets fill in empty fields). */
export async function testChannel(raw: unknown): Promise<ChannelResult> {
  const parsed = channelInputSchema.safeParse({
    ...(raw as object),
    name: (raw as { name?: string })?.name || "test",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const merged = await resolveConfig(parsed.data);
  if (!merged.ok) return { error: "Please check the highlighted fields.", fieldErrors: merged.errors };
  return send(parsed.data.type as ChannelType, merged.config);
}

export async function testSavedChannel(id: string): Promise<ChannelResult> {
  const channel = await getChannel(id);
  try {
    return send(channel.type, openConfig(channel));
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function send(type: ChannelType, config: Record<string, string>): Promise<ChannelResult> {
  try {
    await driverFor(type).send(testMessage(env().APP_URL), config);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** What the settings UI may see: secrets replaced by a "set" marker. */
export interface ChannelView {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  minSeverity: Severity;
  events: EventType[];
  projects: string[];
  config: Record<string, string>;
  secretsSet: string[];
}

export function channelEvents(c: Pick<ChannelRecord, "events">): EventType[] {
  const list = (c.events ?? []).filter((e): e is EventType => (EVENT_TYPES as readonly string[]).includes(e));
  return list.length ? list : [...EVENT_TYPES];
}

export function toView(c: ChannelRecord): ChannelView {
  const secrets = new Set(secretFields(c.type));
  const config: Record<string, string> = {};
  const secretsSet: string[] = [];
  for (const [k, v] of Object.entries(c.config ?? {})) {
    if (secrets.has(k)) {
      if (v) secretsSet.push(k);
    } else config[k] = maskUrlSecrets(String(v ?? ""));
  }
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    enabled: c.enabled,
    minSeverity: c.minSeverity || "unknown",
    events: channelEvents(c),
    projects: c.projects ?? [],
    config,
    secretsSet,
  };
}

export async function listChannels(): Promise<ChannelRecord[]> {
  const pb = await adminPb();
  return pb.collection("channels").getFullList<ChannelRecord>({ sort: "created" });
}

export async function getChannel(id: string): Promise<ChannelRecord> {
  const pb = await adminPb();
  return pb.collection("channels").getOne<ChannelRecord>(id);
}

/**
 * Validates config with the driver's schema. Empty secret fields keep the stored value,
 * so the UI never needs to know a secret to edit the other settings. Not when a server URL
 * points somewhere else: the stored secret would go along to the new server, so it has to be
 * entered again.
 */
export function mergeConfig(
  type: ChannelType,
  input: Record<string, string>,
  previous: Record<string, unknown> | null,
): { ok: true; config: Record<string, string> } | { ok: false; errors: Record<string, string> } {
  const driver = driverFor(type);
  const moved = driver.fields.some(
    (f) =>
      f.kind === "url" &&
      !f.secret &&
      previous?.[f.name] &&
      urlOrigin((input[f.name] ?? "").trim()) !== urlOrigin(previous[f.name]),
  );
  const merged: Record<string, string> = {};
  for (const field of driver.fields) {
    let value = (input[field.name] ?? "").trim();
    const prev = previous?.[field.name];
    // Shown masked (see toView), so the masked form coming back means: unchanged.
    if (typeof prev === "string" && value && value !== prev && value === maskUrlSecrets(prev)) value = prev;
    if (field.secret && !value && !moved && typeof prev === "string" && prev) merged[field.name] = prev;
    else if (value) merged[field.name] = value;
  }
  const parsed = driver.schema.safeParse(merged);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[`config.${issue.path.join(".")}`] ??= issue.message;
    for (const field of driver.fields) {
      if (field.required && !merged[field.name])
        errors[`config.${field.name}`] =
          field.secret && moved
            ? `Enter the ${field.label.toLowerCase()} again: the server changed`
            : `${field.label} is required`;
    }
    return { ok: false, errors };
  }
  return { ok: true, config: parsed.data as Record<string, string> };
}

export async function recentNotifications(
  limit = 30,
): Promise<(NotificationRecord & { channelName: string })[]> {
  const pb = await adminPb();
  const res = await pb
    .collection("notifications")
    .getList<NotificationRecord & { expand?: { channel?: ChannelRecord } }>(1, limit, {
      sort: "-created",
      expand: "channel",
      fields: "id,channel,event,status,attempts,error,sentAt,created,payload,expand.channel.name",
    });
  return res.items.map((n) => ({ ...n, channelName: n.expand?.channel?.name ?? "deleted channel" }));
}
