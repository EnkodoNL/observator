// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { adminPb, toPbDate } from "@/lib/pb/admin";
import type { VulnerabilityRecord } from "@/lib/pb/types";

const DAY = 86_400_000;

/** Keeps the database small: old notification logs, resolved issues and orphaned advisories. */
export async function cleanup(): Promise<void> {
  const pb = await adminPb();
  const olderThan = (days: number) => toPbDate(new Date(Date.now() - days * DAY));

  const oldNotifications = await pb.collection("notifications").getFullList({
    filter: pb.filter("created < {:t} && status != 'pending'", { t: olderThan(90) }),
    fields: "id",
  });
  for (const n of oldNotifications) await pb.collection("notifications").delete(n.id);

  const oldIssues = await pb.collection("issues").getFullList({
    filter: pb.filter("status = 'resolved' && resolvedAt < {:t}", { t: olderThan(180) }),
    fields: "id",
  });
  for (const i of oldIssues) await pb.collection("issues").delete(i.id);

  const [vulns, components] = await Promise.all([
    pb.collection("vulnerabilities").getFullList<VulnerabilityRecord>({ fields: "id,name,version" }),
    pb.collection("components").getFullList<{ name: string; version: string }>({ fields: "name,version" }),
  ]);
  const inUse = new Set(components.map((c) => `${c.name}@${c.version}`));
  for (const v of vulns)
    if (!inUse.has(`${v.name}@${v.version}`)) await pb.collection("vulnerabilities").delete(v.id);
}
