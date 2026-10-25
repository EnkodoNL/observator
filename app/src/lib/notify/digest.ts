// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { channelEvents, listChannels } from "@/lib/data/channels";
import { getOverview } from "@/lib/data/views";
import { env } from "@/lib/env";
import type { NodeSecurityData } from "@/lib/issues/types";
import { kvGet, kvSet } from "@/lib/kv";
import { adminPb, toPbDate } from "@/lib/pb/admin";
import type { IssueRecord, Severity } from "@/lib/pb/types";
import { getSettings } from "@/lib/settings";
import { daysSince } from "@/lib/time";
import { MAX_ITEMS, type Message, type MessageItem } from "./message";
import { enqueue } from "./publish";
import { processQueue } from "./queue";
import { digestDue } from "./schedule";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function buildDigest(now = new Date()): Promise<Message> {
  const [items, settings] = await Promise.all([getOverview(), getSettings()]);
  const pb = await adminPb();
  const weekAgo = toPbDate(new Date(now.getTime() - 7 * 86_400_000));
  const resolved = await pb.collection("issues").getFullList<IssueRecord>({
    filter: pb.filter("status = 'resolved' && resolvedAt >= {:since}", { since: weekAgo }),
    fields: "id,kind,project",
  });
  const resolvedVulns = resolved.filter((i) => i.kind === "vuln").length;

  const attention: MessageItem[] = [];
  let advisories = 0;
  let nodeUpdates = 0;
  for (const { project, latest, summary, lastBuildAt } of items) {
    const parts: string[] = [];
    let severity: Severity | undefined = summary.worstSeverity ?? undefined;
    if (summary.nodeSecurity) {
      const d = summary.nodeSecurity.data as unknown as NodeSecurityData;
      parts.push(`Node ${d.running} → ${d.target}`);
      nodeUpdates++;
      severity ??= "high";
    }
    if (summary.nodeEol) parts.push("Node line end-of-life");
    if (summary.vulnCount) {
      advisories += summary.vulnCount;
      const counts = (["critical", "high"] as const)
        .filter((s) => summary.vulnBySeverity[s])
        .map((s) => `${summary.vulnBySeverity[s]} ${s}`);
      parts.push(
        `${plural(summary.vulnCount, "advisory", "advisories")}${counts.length ? ` (${counts.join(", ")})` : ""}`,
      );
    }
    const age = daysSince(lastBuildAt);
    if (age !== null && age >= settings.staleDays) parts.push(`no build for ${age} days`);
    if (!latest) parts.push("never reported");
    if (parts.length) {
      attention.push({
        severity,
        title: project.name,
        detail: parts.join(" · "),
        url: `${env().APP_URL}/projects/${project.slug}`,
      });
    }
  }

  const versions = new Map<string, number>();
  for (const { latest } of items)
    if (latest) versions.set(latest.nodeVersion, (versions.get(latest.nodeVersion) ?? 0) + 1);
  const nodeLine = [...versions]
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
    .map(([v, n]) => `${v} (${n})`)
    .join(", ");

  const summary = [
    `${plural(items.length, "project")} watched.`,
    attention.length
      ? `${attention.length} need${attention.length === 1 ? "s" : ""} attention${
          nodeUpdates || advisories
            ? `: ${[
                nodeUpdates && plural(nodeUpdates, "Node security update"),
                advisories && plural(advisories, "open advisory", "open advisories"),
              ]
                .filter(Boolean)
                .join(", ")}`
            : ""
        }.`
      : "Nothing needs attention.",
    resolvedVulns ? `${plural(resolvedVulns, "advisory", "advisories")} resolved this week.` : null,
    nodeLine ? `Node in use: ${nodeLine}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    event: "digest.weekly",
    tone: attention.length ? "moderate" : "ok",
    title: attention.length
      ? `Weekly digest: ${plural(attention.length, "project")} need${attention.length === 1 ? "s" : ""} attention`
      : "Weekly digest: all clear",
    summary,
    items: attention.slice(0, MAX_ITEMS),
    more: Math.max(0, attention.length - MAX_ITEMS),
    actions: [{ label: "Open Observator", url: env().APP_URL }],
  };
}

/** Sends the digest when it is due (or now, with force). Returns the week it was sent for. */
export async function sendDigestIfDue({ force = false } = {}): Promise<string | null> {
  const settings = await getSettings();
  if (!settings.digestEnabled && !force) return null;
  const last = await kvGet<string>("digest:lastWeek");
  const { due, week } = digestDue(new Date(), settings, last);
  if (!force && last === null) {
    // First run of a fresh install: start counting from this week instead of catching up.
    await kvSet("digest:lastWeek", week);
    return null;
  }
  if (!due && !force) return null;

  const channels = (await listChannels()).filter(
    (c) => c.enabled && channelEvents(c).includes("digest.weekly"),
  );
  if (channels.length) {
    const message = await buildDigest();
    const key = force ? `digest:${week}:${Date.now()}` : `digest:${week}`;
    for (const channel of channels) await enqueue(channel, "digest.weekly", key, message);
    void processQueue();
  }
  if (!force) await kvSet("digest:lastWeek", week);
  return week;
}
