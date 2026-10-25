// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import type { IssueEvent } from "@/lib/issues/events";

/** Hands issue events to the notification pipeline. */
export async function publish(events: IssueEvent[]): Promise<void> {
  if (events.length === 0) return;
  console.info(`[notify] ${events.length} event(s):`, events.map((e) => `${e.type} ${e.key}`).join(", "));
}
