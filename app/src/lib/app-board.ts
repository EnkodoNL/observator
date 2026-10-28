// SPDX-License-Identifier: FSL-1.1-ALv2
import type { ProjectSummary } from "@/lib/data/views";
import { effectiveLabels, labelValue } from "@/lib/labels";
import type { Severity } from "@/lib/pb/types";
import { maxSeverity } from "@/lib/severity";
import { isStale, worstStatus, type ProjectStatus } from "@/lib/status";

/** One part of an app (label role:*), on one or more servers. */
export interface Service {
  key: string;
  name: string;
  /** The projects behind it: one per server for a shared key split by IP. */
  servers: ProjectSummary[];
  status: ProjectStatus;
  stale: boolean;
  /** Counting advisories by severity; servers run the same code, so the busiest one counts. */
  counts: Partial<Record<Severity, number>>;
  advisories: number;
  buildOnly: number;
}

export interface App {
  key: string;
  name: string;
  services: Service[];
  status: ProjectStatus;
  stale: boolean;
  advisories: number;
  worstSeverity: Severity | null;
  buildOnly: number;
  /** Something to do: open advisories, a runtime update, or builds that stopped. */
  needsWork: boolean;
}

/** The name a build reported, without the " · <ip>" a shared key adds per server. */
export const reportedName = (p: ProjectSummary["project"]) => p.sourceName || p.name;

function serviceName(item: ProjectSummary, app: string): string {
  const role = labelValue(effectiveLabels(item.project), "role");
  if (role) return role;
  const name = reportedName(item.project);
  return name !== app && name.startsWith(`${app}-`) ? name.slice(app.length + 1) : name;
}

function service(key: string, name: string, servers: ProjectSummary[], staleDays: number): Service {
  const busiest = servers.reduce((a, b) => (b.summary.vulnCount > a.summary.vulnCount ? b : a));
  return {
    key,
    name,
    servers,
    status: worstStatus(servers.map((s) => s.summary.status)),
    stale: servers.some((s) => isStale(s.summary, s.lastBuildAt, staleDays)),
    counts: busiest.summary.vulnBySeverity,
    advisories: busiest.summary.vulnCount,
    buildOnly: Math.max(...servers.map((s) => s.summary.buildOnly.length)),
  };
}

const STATUS_ORDER: Record<ProjectStatus, number> = { vulnerable: 0, update: 1, ok: 2, none: 3 };

/**
 * Projects grouped into apps: by label app:*, otherwise by the name the build reported (so a
 * shared key's servers land together), otherwise one app per project. Within an app, one
 * service per role:* label or reported name. Apps that need work come first.
 */
export function appBoard(items: ProjectSummary[], staleDays: number): App[] {
  const apps = new Map<string, { name: string; items: ProjectSummary[] }>();
  for (const item of items) {
    const label = labelValue(effectiveLabels(item.project), "app");
    const name = label ?? reportedName(item.project);
    const key = label ? `label:${label}` : `name:${name}`;
    const app = apps.get(key) ?? { name, items: [] };
    app.items.push(item);
    apps.set(key, app);
  }

  return [...apps]
    .map(([key, { name, items: members }]): App => {
      const byService = new Map<string, { name: string; servers: ProjectSummary[] }>();
      for (const item of members) {
        const sName = serviceName(item, name);
        const entry = byService.get(sName) ?? { name: sName, servers: [] };
        entry.servers.push(item);
        byService.set(sName, entry);
      }
      const services = [...byService]
        .map(([k, s]) => service(k, s.name, s.servers, staleDays))
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
      const status = worstStatus(services.map((s) => s.status));
      const stale = services.some((s) => s.stale);
      return {
        key,
        name,
        services,
        status,
        stale,
        advisories: services.reduce((n, s) => n + s.advisories, 0),
        worstSeverity: maxSeverity(
          services
            .flatMap((s) => s.servers.map((i) => i.summary.worstSeverity))
            .filter((x): x is Severity => x !== null),
        ),
        buildOnly: services.reduce((n, s) => n + s.buildOnly, 0),
        needsWork: status === "vulnerable" || status === "update" || stale,
      };
    })
    .sort(
      (a, b) =>
        Number(b.needsWork) - Number(a.needsWork) ||
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        b.advisories - a.advisories ||
        a.name.localeCompare(b.name),
    );
}
