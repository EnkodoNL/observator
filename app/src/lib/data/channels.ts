// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { EVENT_TYPES, type EventType } from "@/lib/issues/events";
import { driverFor, secretFields } from "@/lib/notify/channels";
import { adminPb } from "@/lib/pb/admin";
import type { ChannelRecord, ChannelType, NotificationRecord, Severity } from "@/lib/pb/types";

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
    } else config[k] = String(v ?? "");
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
 * so the UI never needs to know a secret to edit the other settings.
 */
export function mergeConfig(
  type: ChannelType,
  input: Record<string, string>,
  previous: Record<string, unknown> | null,
): { ok: true; config: Record<string, string> } | { ok: false; errors: Record<string, string> } {
  const driver = driverFor(type);
  const merged: Record<string, string> = {};
  for (const field of driver.fields) {
    const value = (input[field.name] ?? "").trim();
    const prev = previous?.[field.name];
    if (field.secret && !value && typeof prev === "string" && prev) merged[field.name] = prev;
    else if (value) merged[field.name] = value;
  }
  const parsed = driver.schema.safeParse(merged);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[`config.${issue.path.join(".")}`] ??= issue.message;
    for (const field of driver.fields) {
      if (field.required && !merged[field.name])
        errors[`config.${field.name}`] = `${field.label} is required`;
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
