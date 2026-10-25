// SPDX-License-Identifier: FSL-1.1-ALv2
// Record shapes of the PocketBase collections (see pocketbase/pb_migrations).

export type Severity = "unknown" | "low" | "moderate" | "high" | "critical";
export const SEVERITIES: Severity[] = ["unknown", "low", "moderate", "high", "critical"];

export type LockfileType = "npm" | "yarn-v1" | "yarn-berry" | "pnpm" | "none";

interface BaseRecord {
  id: string;
  created: string;
  updated: string;
}

export interface UserRecord extends BaseRecord {
  email: string;
  name?: string;
  verified: boolean;
}

export interface PasskeyRecord extends BaseRecord {
  user: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[] | null;
  deviceType: string;
  backedUp: boolean;
  name: string;
  lastUsed: string;
}

export interface InviteRecord extends BaseRecord {
  tokenHash: string;
  email: string;
  createdBy: string;
  expiresAt: string;
  usedAt: string;
}

export interface ProjectRecord extends BaseRecord {
  name: string;
  slug: string;
  apiKeyHash: string;
  apiKeyPrefix: string;
  badgeToken: string;
  deployWebhookUrl: string;
  deployWebhookMethod: "" | "GET" | "POST";
  deployWebhookToken: string;
  lastBuildAt: string;
  vulnsCheckedAt: string;
}

export interface BuildChanges {
  node?: { from: string; to: string };
  added: { name: string; version: string }[];
  removed: { name: string; version: string }[];
  changed: { name: string; from: string; to: string }[];
  truncated?: boolean;
}

export interface BuildRecord extends BaseRecord {
  project: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  os: string;
  lockfileType: LockfileType;
  lockfileHash: string;
  packageCount: number;
  changes: BuildChanges | null;
  error: string;
}

export interface ComponentRecord extends BaseRecord {
  project: string;
  name: string;
  version: string;
  direct: boolean;
  dev: boolean;
  via: string[] | null;
}

export interface VulnerabilityRecord extends BaseRecord {
  name: string;
  version: string;
  ecosystem: string;
  osvId: string;
  aliases: string[] | null;
  severity: Severity;
  summary: string;
  fixedIn: string;
  url: string;
  modified: string;
  checkedAt: string;
}

export interface IgnoreRecord extends BaseRecord {
  project: string;
  osvId: string;
  package: string;
  reason: string;
  expiresAt: string;
  createdBy: string;
}

export type IssueKind = "node_security" | "node_eol" | "vuln" | "stale";
export type IssueStatus = "open" | "ignored" | "resolved";

export interface IssueRecord extends BaseRecord {
  project: string;
  kind: IssueKind;
  key: string;
  revision: string;
  severity: Severity;
  title: string;
  data: Record<string, unknown> | null;
  status: IssueStatus;
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string;
  notifiedAt: string;
}

export type ChannelType =
  "slack" | "telegram" | "discord" | "email" | "ntfy" | "gotify" | "pushover" | "apprise" | "webhook";

export interface ChannelRecord extends BaseRecord {
  type: ChannelType;
  name: string;
  config: Record<string, unknown> | null;
  enabled: boolean;
  minSeverity: Severity;
  events: string[] | null;
  projects: string[];
}

export interface NotificationRecord extends BaseRecord {
  channel: string;
  event: string;
  dedupeKey: string;
  payload: unknown;
  status: "pending" | "sent" | "failed";
  attempts: number;
  nextAttemptAt: string;
  error: string;
  sentAt: string;
}

export interface KvRecord extends BaseRecord {
  key: string;
  value: unknown;
  expiresAt: string;
}
