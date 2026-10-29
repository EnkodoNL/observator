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
  /** Set for projects created on the fly by a shared key. */
  ingestKey: string;
  /** The project name as reported with the shared key. */
  sourceName: string;
  /** Source IP the project was split by, when the shared key splits by IP. */
  instance: string;
  /** Labels kept by hand (UI, MCP). */
  labels: string[] | null;
  /** Labels from the latest report (OBSERVATOR_LABELS). */
  buildLabels: string[] | null;
}

export interface McpTokenRecord extends BaseRecord {
  user: string;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  /** Read and write; without it the token only reads. */
  canWrite: boolean;
  lastUsedAt: string;
  lastUsedIp: string;
}

export interface IngestKeyRecord extends BaseRecord {
  name: string;
  keyHash: string;
  keyPrefix: string;
  splitByIp: boolean;
  createdBy: string;
  lastUsedAt: string;
  lastUsedIp: string;
  /** Addresses that may report without a key, as this key. */
  allowedIps: { cidr: string; note: string }[] | null;
}

export interface BuildChanges {
  /** package.json version, when it changed. */
  app?: { from: string; to: string };
  /** Runtimes whose version changed; from or to is null when one was added or removed. */
  runtimes?: { name: string; from: string | null; to: string | null }[];
  added: { name: string; version: string }[];
  removed: { name: string; version: string }[];
  changed: { name: string; from: string; to: string }[];
  truncated?: boolean;
}

export interface BuildRecord extends BaseRecord {
  project: string;
  /** As reported in X-Runtime, in that order: [{ name: "node", version: "22.11.0" }]. */
  runtimes: { name: string; version: string }[] | null;
  /** name and version from package.json, for information. */
  appName: string;
  appVersion: string;
  platform: string;
  arch: string;
  os: string;
  lockfileType: LockfileType;
  lockfileHash: string;
  packageCount: number;
  changes: BuildChanges | null;
  error: string;
  sourceIp: string;
}

export interface ComponentRecord extends BaseRecord {
  project: string;
  /** OSV ecosystem of the package: "npm" for now. */
  ecosystem: string;
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

/** How close something is to expiring; see lib/domains/phase.ts. */
export type ExpiryPhase = "ok" | "remind" | "warn" | "urgent" | "expired";

/** What has been sent for a domain or host: a notification goes out when phase gets worse. */
export interface AlertState {
  phase: ExpiryPhase;
  notifiedPhase: ExpiryPhase;
}

export interface RegistrationInfo {
  /** From RDAP; null when the registry publishes none or the check failed. */
  expiresAt: string | null;
  source: "rdap" | "unpublished" | "unsupported" | "failed";
  error?: string;
  checkedAt: string;
}

export interface CertInfo {
  expiresAt: string | null;
  validFrom: string | null;
  issuer: string;
  /** Why the certificate is not valid for this name (CERT_HAS_EXPIRED, ERR_TLS_CERT_ALTNAME_INVALID). */
  error: string;
  /** The host could not be reached at all (ECONNREFUSED, a timeout): no verdict on the certificate. */
  unreachable: string;
  checkedAt: string;
}

/** A registered domain, such as enkodo.dev: its registration expires. */
export interface DomainRecord extends BaseRecord {
  name: string;
  /** Added by hand; otherwise it is there for its hosts and goes when the last one does. */
  manual: boolean;
  note: string;
  /** Days before expiry for a reminder of one's own; 0 is none. */
  remindDays: number;
  /** For registries that publish no expiry: the date from the registrar. */
  manualExpiresAt: string;
  registration: RegistrationInfo | null;
  alert: AlertState | null;
}

export type HostSource = "manual" | "build" | "coolify";

/** A name whose TLS certificate is checked, such as app.enkodo.dev, under its registered domain. */
export interface HostRecord extends BaseRecord {
  name: string;
  domain: string;
  project: string;
  sources: HostSource[] | null;
  cert: CertInfo | null;
  alert: AlertState | null;
}

export type IssueKind = "runtime_security" | "runtime_eol" | "vuln" | "stale";
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
