// SPDX-License-Identifier: FSL-1.1-ALv2
import type { EventType, IssueEvent } from "@/lib/issues/events";
import type { RuntimeEolData, RuntimeSecurityData, StaleData, VulnIssueData } from "@/lib/issues/types";
import { pinFor, runtimeLabel } from "@/lib/runtimes/labels";
import type { Severity } from "@/lib/pb/types";
import { maxSeverity, severityRank } from "@/lib/severity";
import { MAX_ITEMS, type Message, type MessageAction, type MessageItem } from "./message";

export interface ProjectInfo {
  name: string;
  slug: string;
  canRedeploy: boolean;
}

export interface RenderContext {
  appUrl: string;
  projects: Map<string, ProjectInfo>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function projectActions(ctx: RenderContext, projectIds: string[], tab?: string): MessageAction[] {
  const unique = [...new Set(projectIds)];
  if (unique.length !== 1) return [{ label: "Open Observator", url: ctx.appUrl }];
  const p = ctx.projects.get(unique[0]);
  if (!p) return [{ label: "Open Observator", url: ctx.appUrl }];
  const base = `${ctx.appUrl}/projects/${p.slug}`;
  const actions: MessageAction[] = [{ label: "Open project", url: tab ? `${base}?tab=${tab}` : base }];
  if (p.canRedeploy) actions.push({ label: "Redeploy", url: `${base}?redeploy=1` });
  return actions;
}

function cap(items: MessageItem[]): { items: MessageItem[]; more: number } {
  return { items: items.slice(0, MAX_ITEMS), more: Math.max(0, items.length - MAX_ITEMS) };
}

const name = (ctx: RenderContext, id: string) => ctx.projects.get(id)?.name ?? "unknown project";

function severityCounts(events: IssueEvent[]): string {
  const order: Severity[] = ["critical", "high", "moderate", "low", "unknown"];
  return order
    .map((s) => [s, events.filter((e) => e.severity === s).length] as const)
    .filter(([, n]) => n)
    .map(([s, n]) => `${n} ${s}`)
    .join(", ");
}

/**
 * One message for all events of one type in one run, so ten new advisories in a build,
 * or one Node.js security release that affects four projects, become a single message.
 */
export function renderEvents(
  type: Exclude<EventType, "digest.weekly">,
  events: IssueEvent[],
  ctx: RenderContext,
): Message {
  const projectIds = events.map((e) => e.projectId);
  const projects = [...new Set(projectIds)];
  const reminder = events.every((e) => e.reminder);
  const prefix = reminder ? "Still open: " : "";

  switch (type) {
    case "runtime.security_update": {
      const pinText = (d: RuntimeSecurityData) => {
        const pin = pinFor(d.runtime, d.target, d.os);
        return pin ? `pin ${pin} and redeploy` : `move to ${d.target} and redeploy`;
      };
      const items = events.map((e) => {
        const d = e.data as unknown as RuntimeSecurityData;
        return {
          severity: "high" as Severity,
          title: name(ctx, e.projectId),
          detail: `runs ${runtimeLabel(d.runtime)} ${d.running}; ${pinText(d)}`,
          url: `${ctx.appUrl}/projects/${ctx.projects.get(e.projectId)?.slug ?? ""}`,
        };
      });
      const all = events.map((e) => e.data as unknown as RuntimeSecurityData);
      const runtimes = [...new Set(all.map((d) => runtimeLabel(d.runtime)))].join(" and ");
      const targets = [...new Set(all.map((d) => d.target))];
      const first = all[0];
      return {
        event: type,
        tone: "high",
        title:
          projects.length === 1 && events.length === 1
            ? `${prefix}${runtimeLabel(first.runtime)} security update for ${name(ctx, projects[0])}: ${first.target}`
            : `${prefix}${runtimes} security update for ${plural(projects.length, "project")}`,
        summary:
          projects.length === 1 && events.length === 1
            ? `${name(ctx, projects[0])} runs ${runtimeLabel(first.runtime)} ${first.running}. ${first.securityReleases.at(-1)} is a security release. ${pinText(first).replace(/^./, (c) => c.toUpperCase())}.`
            : `A newer ${runtimes} security release is out (${targets.join(", ")}). These projects still run an older version:`,
        ...cap(projects.length === 1 && events.length === 1 ? [] : items),
        actions:
          projects.length === 1
            ? projectActions(ctx, projects)
            : [{ label: "Runtimes overview", url: `${ctx.appUrl}/runtimes` }],
      };
    }

    case "runtime.eol": {
      const items = events.map((e) => {
        const d = e.data as unknown as RuntimeEolData;
        return {
          severity: e.severity,
          title: name(ctx, e.projectId),
          detail:
            d.phase === "eol"
              ? `${runtimeLabel(d.runtime)} ${d.line} has been end-of-life since ${d.end}`
              : `${runtimeLabel(d.runtime)} ${d.line} ends on ${d.end}`,
        };
      });
      const d = events[0].data as unknown as RuntimeEolData;
      const label = runtimeLabel(d.runtime);
      return {
        event: type,
        tone: events.some((e) => (e.data as unknown as RuntimeEolData).phase === "eol") ? "high" : "moderate",
        title:
          d.phase === "eol"
            ? `${prefix}${label} ${d.line} is end-of-life (${plural(projects.length, "project")})`
            : `${prefix}${label} ${d.line} reaches end-of-life on ${d.end}`,
        summary:
          d.phase === "eol"
            ? `These projects run a ${label} release line that no longer gets security fixes. Move them to a supported line.`
            : `These projects run a ${label} release line that stops getting security fixes within 30 days.`,
        ...cap(items),
        actions: projectActions(ctx, projectIds),
      };
    }

    case "vuln.new":
    case "vuln.resolved": {
      const resolved = type === "vuln.resolved";
      const sorted = [...events].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
      const items = sorted.map((e) => {
        const d = e.data as unknown as VulnIssueData;
        const where = projects.length > 1 ? `${name(ctx, e.projectId)}: ` : "";
        const via = d.direct ? "direct" : d.via?.length ? `via ${d.via.join(", ")}` : "transitive";
        return {
          severity: e.severity,
          title: `${where}${d.package}@${d.version}`,
          detail: resolved
            ? `${d.summary || d.osvId} (${d.osvId})`
            : [
                d.summary || d.osvId,
                d.fixedIn ? `fixed in ${d.fixedIn}` : "no fix yet",
                via,
                d.dev ? "dev" : null,
              ]
                .filter(Boolean)
                .join(" · "),
          url: d.url,
        };
      });
      const where =
        projects.length === 1
          ? `in ${name(ctx, projects[0])}`
          : `across ${plural(projects.length, "project")}`;
      return {
        event: type,
        tone: resolved ? "ok" : (maxSeverity(events.map((e) => e.severity)) ?? "unknown"),
        title: resolved
          ? `${plural(events.length, "vulnerability", "vulnerabilities")} resolved ${where}`
          : `${prefix}${plural(events.length, "new vulnerability", "new vulnerabilities")} ${where}`,
        summary: resolved
          ? "The latest build no longer contains these advisories."
          : `${severityCounts(events)}. Upgrade to the fixed versions, or ignore an advisory in Observator if it does not apply.`,
        ...cap(items),
        actions: projectActions(ctx, projectIds),
      };
    }

    case "project.stale": {
      const items = events.map((e) => ({
        title: name(ctx, e.projectId),
        detail: `last build ${(e.data as unknown as StaleData).days} days ago`,
      }));
      return {
        event: type,
        tone: "low",
        title:
          projects.length === 1
            ? `${prefix}${name(ctx, projects[0])} has not reported for ${(events[0].data as unknown as StaleData).days} days`
            : `${prefix}${plural(projects.length, "project")} stopped reporting`,
        summary:
          "No build has reported in a while. Either nothing was deployed, or the Dockerfile snippet or key stopped working.",
        ...cap(projects.length === 1 ? [] : items),
        actions: projectActions(ctx, projectIds, "builds"),
      };
    }
  }
}

export function testMessage(appUrl: string): Message {
  return {
    event: "vuln.new",
    tone: "info",
    title: "Observator test notification",
    summary: "If you can read this, the channel works. Real messages look like this one.",
    items: [
      {
        severity: "high",
        title: "example-app",
        detail: "runs Node.js 22.11.0; pin node:22.23.4-alpine and redeploy",
      },
      {
        severity: "critical",
        title: "minimist@1.2.5",
        detail: "Prototype Pollution · fixed in 1.2.6 · direct",
      },
    ],
    more: 0,
    actions: [{ label: "Open Observator", url: appUrl }],
  };
}
