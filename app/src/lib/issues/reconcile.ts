// SPDX-License-Identifier: FSL-1.1-ALv2
import type { IgnoreRecord, IssueRecord, IssueStatus } from "@/lib/pb/types";
import type { DesiredIssue } from "./desired";
import { OPEN_EVENT, type IssueEvent } from "./events";
import type { VulnIssueData } from "./types";

export interface IssueWrite {
  kind: DesiredIssue["kind"];
  key: string;
  revision: string;
  severity: DesiredIssue["severity"];
  title: string;
  data: DesiredIssue["data"];
  status: IssueStatus;
  firstSeen?: Date;
  lastSeen: Date;
  resolvedAt?: Date | null;
}

export interface ReconcileResult {
  creates: IssueWrite[];
  updates: { id: string; patch: Partial<IssueWrite> }[];
  events: IssueEvent[];
}

const active = (ignore: IgnoreRecord, now: Date) =>
  !ignore.expiresAt || new Date(ignore.expiresAt.replace(" ", "T")).getTime() > now.getTime();

/** An ignore matches a vulnerability by advisory id (or alias), by package, or both. */
export function matchingIgnore(
  issue: DesiredIssue,
  projectId: string,
  ignores: IgnoreRecord[],
  now: Date,
): IgnoreRecord | null {
  if (issue.kind !== "vuln") return null;
  const d = issue.data as VulnIssueData;
  const ids = new Set([d.osvId, ...d.aliases].map((s) => s.toUpperCase()));
  return (
    ignores.find((ig) => {
      if (ig.project && ig.project !== projectId) return false;
      if (!ig.osvId && !ig.package) return false;
      if (ig.osvId && !ids.has(ig.osvId.trim().toUpperCase())) return false;
      if (ig.package && ig.package.trim() !== d.package) return false;
      return active(ig, now);
    }) ?? null
  );
}

/**
 * Compares what should be open with what is stored and returns the writes plus the
 * events worth telling someone about. Pure, so the rules are testable:
 *
 * - new problem: open + event (or ignored, silently, when an ignore matches)
 * - same problem, new revision (e.g. a newer Node security release): event again
 * - ignore removed or expired: open again + event
 * - problem gone: resolved; vuln.resolved only if the issue had been notified
 */
export function reconcile(
  projectId: string,
  existing: IssueRecord[],
  desired: DesiredIssue[],
  ignores: IgnoreRecord[],
  now: Date,
): ReconcileResult {
  const result: ReconcileResult = { creates: [], updates: [], events: [] };
  const byKey = new Map(existing.map((i) => [i.key, i]));
  const event = (
    d: {
      kind: DesiredIssue["kind"];
      key: string;
      revision: string;
      severity: DesiredIssue["severity"];
      title: string;
      data: unknown;
    },
    type: IssueEvent["type"],
  ): IssueEvent => ({
    type,
    projectId,
    kind: d.kind,
    key: d.key,
    revision: d.revision,
    severity: d.severity,
    title: d.title,
    data: d.data as Record<string, unknown>,
  });

  for (const d of desired) {
    const status: IssueStatus = matchingIgnore(d, projectId, ignores, now) ? "ignored" : "open";
    const current = byKey.get(d.key);
    byKey.delete(d.key);
    const fields = {
      kind: d.kind,
      key: d.key,
      revision: d.revision,
      severity: d.severity,
      title: d.title,
      data: d.data,
    };

    if (!current) {
      result.creates.push({ ...fields, status, firstSeen: now, lastSeen: now });
      if (status === "open") result.events.push(event(d, OPEN_EVENT[d.kind]));
      continue;
    }

    const reopened = current.status === "resolved";
    const unignored = current.status === "ignored" && status === "open";
    const revised = current.status === "open" && status === "open" && current.revision !== d.revision;
    result.updates.push({
      id: current.id,
      patch: {
        ...fields,
        status,
        lastSeen: now,
        ...(reopened ? { firstSeen: now, resolvedAt: null } : {}),
      },
    });
    if (status === "open" && (reopened || unignored || revised))
      result.events.push(event(d, OPEN_EVENT[d.kind]));
  }

  for (const gone of byKey.values()) {
    if (gone.status === "resolved") continue;
    result.updates.push({ id: gone.id, patch: { status: "resolved", resolvedAt: now } });
    if (gone.kind === "vuln" && gone.status === "open" && gone.notifiedAt) {
      result.events.push(
        event(
          { ...gone, data: gone.data ?? {}, kind: gone.kind, severity: gone.severity || "unknown" },
          "vuln.resolved",
        ),
      );
    }
  }
  return result;
}
