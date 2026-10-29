// SPDX-License-Identifier: FSL-1.1-ALv2
import type { ExpiryPhase, IssueKind, Severity } from "@/lib/pb/types";

export const EVENT_TYPES = [
  "runtime.security_update",
  "runtime.eol",
  "vuln.new",
  "vuln.resolved",
  "project.stale",
  "domain.expiring",
  "digest.weekly",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABEL: Record<EventType, string> = {
  "runtime.security_update": "Runtime security update",
  "runtime.eol": "Runtime end-of-life",
  "vuln.new": "New vulnerability",
  "vuln.resolved": "Vulnerability resolved",
  "project.stale": "Project stale",
  "domain.expiring": "Domain or certificate expiring",
  "digest.weekly": "Weekly digest",
};

export interface IssueEvent {
  type: Exclude<EventType, "digest.weekly" | "domain.expiring">;
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

/**
 * A domain's registration or a host's certificate reached a worse phase. Not an issue: domains
 * need no project, so they keep their own phase (lib/domains/check.ts).
 */
export interface DomainEvent {
  type: "domain.expiring";
  target: "registration" | "certificate";
  name: string;
  phase: ExpiryPhase;
  expiresAt: string | null;
  /** Why a certificate is not valid, when it is not. */
  error: string;
  note: string;
  /** Projects its hosts belong to; none for a domain watched on its own. */
  projectIds: string[];
  occurredAt: string;
}
