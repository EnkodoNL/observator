// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { channelEvents, listChannels } from "@/lib/data/channels";
import { sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import type { EventType, IssueEvent } from "@/lib/issues/events";
import { adminPb, isUniqueViolation, toPbDate } from "@/lib/pb/admin";
import type { ChannelRecord, ProjectRecord } from "@/lib/pb/types";
import { atLeast } from "@/lib/severity";
import type { Message } from "./message";
import { processQueue } from "./queue";
import { renderEvents, type ProjectInfo, type RenderContext } from "./render";

export async function renderContext(): Promise<RenderContext> {
  const pb = await adminPb();
  const projects = await pb
    .collection("projects")
    .getFullList<ProjectRecord>({ fields: "id,name,slug,deployWebhookUrl" });
  return {
    appUrl: env().APP_URL,
    projects: new Map<string, ProjectInfo>(
      projects.map((p) => [p.id, { name: p.name, slug: p.slug, canRedeploy: Boolean(p.deployWebhookUrl) }]),
    ),
  };
}

/** Which of these events a channel wants, after its event, project and severity filters. */
export function eventsForChannel(
  channel: Pick<ChannelRecord, "events" | "projects" | "minSeverity">,
  events: IssueEvent[],
): IssueEvent[] {
  const types = new Set<EventType>(channelEvents(channel));
  const projects = channel.projects ?? [];
  return events.filter((e) => {
    if (!types.has(e.type)) return false;
    if (projects.length && !projects.includes(e.projectId)) return false;
    // The severity filter is about packages; runtime security updates always come through.
    if (e.type.startsWith("vuln.") && channel.minSeverity && !atLeast(e.severity, channel.minSeverity))
      return false;
    return true;
  });
}

export function dedupeKey(type: string, events: IssueEvent[]): string {
  const parts = events
    .map((e) => `${e.projectId}/${e.key}/${e.revision}/${e.occurredAt}${e.reminder ? "/r" : ""}`)
    .sort();
  return `${type}:${sha256(parts.join("\n")).slice(0, 32)}`;
}

/** Queues one bundled message per channel and event type. */
export async function enqueue(
  channel: ChannelRecord,
  event: EventType,
  key: string,
  message: Message,
): Promise<boolean> {
  const pb = await adminPb();
  try {
    await pb.collection("notifications").create({
      channel: channel.id,
      event,
      dedupeKey: key,
      payload: message,
      status: "pending",
      attempts: 0,
      nextAttemptAt: toPbDate(new Date()),
    });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

/**
 * Hands issue events to the notification pipeline: filter per channel, bundle per event
 * type, queue, then send in the background. Issues that reached a channel get notifiedAt.
 */
export async function publish(events: IssueEvent[]): Promise<void> {
  if (events.length === 0) return;
  const channels = (await listChannels()).filter((c) => c.enabled);
  if (channels.length === 0) return;
  const ctx = await renderContext();
  const notified = new Set<string>();

  for (const channel of channels) {
    const wanted = eventsForChannel(channel, events);
    const byType = new Map<IssueEvent["type"], IssueEvent[]>();
    for (const e of wanted) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
    for (const [type, group] of byType) {
      await enqueue(channel, type, dedupeKey(type, group), renderEvents(type, group, ctx));
      for (const e of group) if (type !== "vuln.resolved") notified.add(`${e.projectId}\n${e.key}`);
    }
  }

  if (notified.size) {
    const pb = await adminPb();
    const now = toPbDate(new Date());
    for (const id of notified) {
      const [project, key] = id.split("\n");
      const issue = await pb
        .collection("issues")
        .getFirstListItem(pb.filter("project = {:project} && key = {:key}", { project, key }))
        .catch(() => null);
      if (issue) await pb.collection("issues").update(issue.id, { notifiedAt: now });
    }
  }
  void processQueue();
}
