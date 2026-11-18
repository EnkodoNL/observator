// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { listIngestKeys } from "@/lib/data/ingest-keys";
import { getOverview } from "@/lib/data/views";
import { listDomains } from "@/lib/domains/data";
import { domainAttention } from "@/lib/domains/phase";
import { env } from "@/lib/env";
import type { RuntimeEolData, RuntimeSecurityData } from "@/lib/issues/types";
import { staleReason } from "@/lib/issues/types";
import { effectiveLabels, hasLabels } from "@/lib/labels";
import type { BuildRecord, IssueRecord } from "@/lib/pb/types";
import {
  CHECKED_RUNTIMES,
  imageAction,
  lineDescription,
  pinAdvice,
  pinLine,
  runtimeLabel,
} from "@/lib/runtimes/labels";
import type { Evaluator } from "@/lib/runtimes/types";
import { getSettings } from "@/lib/settings";
import { isStale, type ProjectStatus } from "@/lib/status";
import { triage, type Cause } from "@/lib/triage";

/**
 * The project list as list_projects (MCP) and GET /api/status show it: one source, so both
 * answer with the same fields.
 */

export const PROJECT_STATUSES = [
  "none",
  "unchecked",
  "ok",
  "update",
  "vulnerable",
] as const satisfies readonly ProjectStatus[];

export const projectUrl = (slug: string) => `${env().APP_URL}/projects/${slug}`;

/**
 * The runtimes of a build with what Observator knows about each: the release line, an open
 * security update with the image to pin, end of life. Unchecked runtimes are listed as such.
 */
export function describeRuntimes(
  build: Pick<BuildRecord, "runtimes" | "os"> | null,
  issues: { security: IssueRecord[]; eol: IssueRecord[] },
  evaluators?: Map<string, Evaluator>,
) {
  return (build?.runtimes ?? []).map((r) => {
    const security = issues.security
      .map((i) => i.data as unknown as RuntimeSecurityData)
      .find((d) => d.runtime === r.name);
    const eol = issues.eol.map((i) => i.data as unknown as RuntimeEolData).find((d) => d.runtime === r.name);
    // A Coolify database or service gets a new image in Coolify instead of a Dockerfile pin.
    const image = security?.image;
    const pin = image
      ? image.embedded
        ? null
        : `${image.name}:${security!.target}`
      : security
        ? pinLine(r.name, security.target, security.os)
        : null;
    const advice = image ? imageAction(r.name, security!.target, image) : pin ? pinAdvice(r.name) : null;
    return {
      name: r.name,
      label: runtimeLabel(r.name),
      version: r.version,
      checked: CHECKED_RUNTIMES.includes(r.name),
      ...(evaluators ? { line: lineDescription(evaluators.get(r.name)?.(r.version) ?? null) } : {}),
      securityUpdate: security
        ? {
            target: security.target,
            // false: endoflife.date names no security release, only a newer patch.
            security: security.securityReleases.length > 0,
            ...(pin ? { pin } : {}),
            ...(advice ? { advice } : {}),
          }
        : null,
      endOfLife: eol ? { phase: eol.phase, end: eol.end } : null,
    };
  });
}

export interface ProjectFilter {
  /** Only projects that have all of these labels. */
  labels?: string[];
  status?: ProjectStatus;
  /** Part of the name or slug. */
  query?: string;
}

type OverviewItem = Awaited<ReturnType<typeof getOverview>>[number];

function matches({ labels, status, query }: ProjectFilter) {
  const wanted = (labels ?? []).map((l) => l.toLowerCase());
  const q = query?.trim().toLowerCase();
  return (i: OverviewItem) =>
    hasLabels(effectiveLabels(i.project), wanted) &&
    (!status || i.summary.status === status) &&
    (!q || i.project.name.toLowerCase().includes(q) || i.project.slug.includes(q));
}

function toSummary({ project: p, latest, summary, lastBuildAt }: OverviewItem, keyName: Map<string, string>) {
  return {
    slug: p.slug,
    name: p.name,
    url: projectUrl(p.slug),
    status: summary.status,
    stale: isStale(summary),
    staleReason: summary.staleIssue ? staleReason(summary.staleIssue.data) : null,
    labels: effectiveLabels(p),
    runtimes: describeRuntimes(latest, { security: summary.runtimeSecurity, eol: summary.runtimeEol }),
    app: latest?.appVersion ? { name: latest.appName, version: latest.appVersion } : null,
    advisories: summary.vulnBySeverity,
    buildOnly: summary.buildOnly.length,
    lastBuild: lastBuildAt?.toISOString() ?? null,
    sharedKey: p.ingestKey ? (keyName.get(p.ingestKey) ?? "revoked") : null,
    server: p.instance || null,
    // A Coolify database or service, synced from Coolify rather than reported by a build.
    source: p.coolifyKind ? `coolify-${p.coolifyKind}` : null,
    ...(p.coolifyGoneAt ? { goneFromCoolify: p.coolifyGoneAt } : {}),
  };
}

export async function listProjectSummaries(filter: ProjectFilter = {}) {
  const [items, keys] = await Promise.all([getOverview(), listIngestKeys()]);
  const keyName = new Map(keys.map((k) => [k.id, k.name]));
  return items.filter(matches(filter)).map((i) => toSummary(i, keyName));
}

/** Where a cause without a page of its own sends you: the runtimes overview, or the projects. */
function fallbackHref(cause: Cause): string {
  if (cause.kind === "runtime_security" || cause.kind === "runtime_eol") return "/runtimes";
  if (cause.kind === "domain") return "/domains";
  return "/projects";
}

/**
 * Everything GET /api/status answers: the projects as list_projects shows them, their counts per
 * status, and what to do across them (the To do list of the overview page), with absolute links.
 */
export async function statusReport(filter: ProjectFilter = {}) {
  const [all, keys, settings, watched] = await Promise.all([
    getOverview(),
    listIngestKeys(),
    getSettings(),
    listDomains(),
  ]);
  const keyName = new Map(keys.map((k) => [k.id, k.name]));
  const items = all.filter(matches(filter));
  const filtered = Boolean(filter.labels?.length || filter.status || filter.query?.trim());
  const shown = new Set(items.map((i) => i.project.id));
  // As on the overview page: with a filter, only domains of the projects shown.
  const domains = domainAttention(
    watched,
    { warnDays: settings.domainWarnDays, urgentDays: settings.domainUrgentDays },
    new Date(),
  ).filter((d) => !filtered || d.projectIds.some((id) => shown.has(id)));
  const projects = items.map((i) => toSummary(i, keyName));
  const base = env().APP_URL.replace(/\/+$/, "");
  const todo = triage(items, domains).map((c) => ({
    ...c,
    href: `${base}${c.href || fallbackHref(c)}`,
    ...(c.kind === "runtime_security" || c.kind === "runtime_eol" ? { label: runtimeLabel(c.runtime) } : {}),
  }));
  return { counts: countByStatus(projects), projects, todo };
}

export type ProjectSummary = Awaited<ReturnType<typeof listProjectSummaries>>[number];

/** How many projects have each status; every status is present, zero or not. */
export function countByStatus(projects: { status: string }[]): Record<ProjectStatus, number> {
  const counts = Object.fromEntries(PROJECT_STATUSES.map((s) => [s, 0])) as Record<ProjectStatus, number>;
  for (const p of projects) if (p.status in counts) counts[p.status as ProjectStatus] += 1;
  return counts;
}
