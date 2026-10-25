// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { OPEN_EVENT, type IssueEvent } from "@/lib/issues/events";
import { adminPb, toPbDate } from "@/lib/pb/admin";
import type { IssueRecord } from "@/lib/pb/types";
import { getSettings } from "@/lib/settings";
import { publish } from "./publish";

/** Re-announces issues that are still open after the configured number of days. */
export async function sendReminders(): Promise<number> {
  const { renotifyDays } = await getSettings();
  if (renotifyDays <= 0) return 0;
  const pb = await adminPb();
  const cutoff = toPbDate(new Date(Date.now() - renotifyDays * 86_400_000));
  const due = await pb.collection("issues").getFullList<IssueRecord>({
    filter: pb.filter("status = 'open' && notifiedAt != '' && notifiedAt <= {:cutoff}", { cutoff }),
  });
  const today = new Date().toISOString().slice(0, 10);
  const events: IssueEvent[] = due.map((i) => ({
    type: OPEN_EVENT[i.kind],
    projectId: i.project,
    kind: i.kind,
    key: i.key,
    revision: i.revision,
    severity: i.severity || "unknown",
    title: i.title,
    data: i.data ?? {},
    occurredAt: today,
    reminder: true,
  }));
  await publish(events);
  return events.length;
}
