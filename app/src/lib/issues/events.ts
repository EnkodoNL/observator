// SPDX-License-Identifier: FSL-1.1-ALv2
import type { IssueKind, Severity } from "@/lib/pb/types";

export const EVENT_TYPES = [
  "runtime.security_update",
  "runtime.eol",
  "vuln.new",
  "vuln.resolved",
  "project.stale",
  "digest.weekly",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABEL: Record<EventType, string> = {
  "runtime.security_update": "Runtime security update",
  "runtime.eol": "Runtime end-of-life",
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
  /** When this occurrence happened; part of the notification dedupe key. */
  occurredAt: string;
  /** Re-sent because the issue is still open after the reminder interval. */
  reminder?: boolean;
}

export const OPEN_EVENT: Record<IssueKind, IssueEvent["type"]> = {
  runtime_security: "runtime.security_update",
  runtime_eol: "runtime.eol",
  vuln: "vuln.new",
  stale: "project.stale",
};
