// SPDX-License-Identifier: FSL-1.1-ALv2
import type { IssueKind, Severity } from "@/lib/pb/types";

export const EVENT_TYPES = [
  "node.security_update",
  "node.eol",
  "vuln.new",
  "vuln.resolved",
  "project.stale",
  "digest.weekly",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABEL: Record<EventType, string> = {
  "node.security_update": "Node security update",
  "node.eol": "Node end-of-life",
  "vuln.new": "New vulnerability",
  "vuln.resolved": "Vulnerability resolved",
  "project.stale": "Project stale",
  "digest.weekly": "Weekly digest",
};

export interface IssueEvent {
  type: Exclude<EventType, "digest.weekly">;
  projectId: string;
  kind: IssueKind;
  key: string;
  revision: string;
  severity: Severity;
  title: string;
  data: Record<string, unknown>;
  /** Re-sent because the issue is still open after the reminder interval. */
  reminder?: boolean;
}

export const OPEN_EVENT: Record<IssueKind, IssueEvent["type"]> = {
  node_security: "node.security_update",
  node_eol: "node.eol",
  vuln: "vuln.new",
  stale: "project.stale",
};
