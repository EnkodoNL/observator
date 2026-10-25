// SPDX-License-Identifier: FSL-1.1-ALv2
import type { EventType, IssueEvent } from "@/lib/issues/events";
import type { NodeEolData, NodeSecurityData, StaleData, VulnIssueData } from "@/lib/issues/types";
import { pinnedImage } from "@/lib/node/advice";
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
 * or one Node security release that affects four projects, become a single message.
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
    case "node.security_update": {
      const items = events.map((e) => {
        const d = e.data as unknown as NodeSecurityData;
        return {
          severity: "high" as Severity,
          title: name(ctx, e.projectId),
          detail: `runs ${d.running}; pin ${pinnedImage(d.target, d.os)} and redeploy`,
          url: `${ctx.appUrl}/projects/${ctx.projects.get(e.projectId)?.slug ?? ""}`,
        };
      });
      const targets = [...new Set(events.map((e) => (e.data as unknown as NodeSecurityData).target))];
      const first = events[0].data as unknown as NodeSecurityData;
      return {
        event: type,
        tone: "high",
        title:
          projects.length === 1
            ? `${prefix}Node security update for ${name(ctx, projects[0])}: ${first.target}`
            : `${prefix}Node security update for ${plural(projects.length, "project")}`,
        summary:
          projects.length === 1
            ? `${name(ctx, projects[0])} runs Node ${first.running}. Node ${first.securityReleases.at(-1)} is a security release. Pin ${pinnedImage(first.target, first.os)} and redeploy.`
            : `A newer Node security release is out (${targets.join(", ")}). These projects still run an older version:`,
        ...cap(projects.length === 1 ? [] : items),
        actions:
          projects.length === 1
            ? projectActions(ctx, projects)
            : [{ label: "Node overview", url: `${ctx.appUrl}/node` }],
      };
    }

    case "node.eol": {
      const items = events.map((e) => {
        const d = e.data as unknown as NodeEolData;
        return {
          severity: e.severity,
          title: name(ctx, e.projectId),
          detail:
            d.phase === "eol"
              ? `Node ${d.major} has been end-of-life since ${d.end}`
              : `Node ${d.major} ends on ${d.end}`,
        };
      });
      const d = events[0].data as unknown as NodeEolData;
      return {
        event: type,
        tone: events.some((e) => (e.data as unknown as NodeEolData).phase === "eol") ? "high" : "moderate",
        title:
          d.phase === "eol"
            ? `${prefix}Node ${d.major} is end-of-life (${plural(projects.length, "project")})`
            : `${prefix}Node ${d.major} reaches end-of-life on ${d.end}`,
        summary:
          d.phase === "eol"
            ? "These projects run a Node release line that no longer gets security fixes. Move them to a supported LTS line."
            : "These projects run a Node release line that stops getting security fixes within 30 days.",
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
        detail: "runs Node 22.11.0; pin node:22.23.4-alpine and redeploy",
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
