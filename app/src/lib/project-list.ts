// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { listIngestKeys } from "@/lib/data/ingest-keys";
import { getOverview } from "@/lib/data/views";
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
import { isStale, type ProjectStatus } from "@/lib/status";

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

export async function listProjectSummaries({ labels, status, query }: ProjectFilter = {}) {
  const [items, keys] = await Promise.all([getOverview(), listIngestKeys()]);
  const keyName = new Map(keys.map((k) => [k.id, k.name]));
  const q = query?.trim().toLowerCase();
  return items
    .filter((i) =>
      hasLabels(
        effectiveLabels(i.project),
        (labels ?? []).map((l) => l.toLowerCase()),
      ),
    )
    .filter((i) => !status || i.summary.status === status)
    .filter((i) => !q || i.project.name.toLowerCase().includes(q) || i.project.slug.includes(q))
    .map(({ project: p, latest, summary, lastBuildAt }) => ({
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
    }));
}

export type ProjectSummary = Awaited<ReturnType<typeof listProjectSummaries>>[number];

/** How many projects have each status; every status is present, zero or not. */
export function countByStatus(projects: { status: string }[]): Record<ProjectStatus, number> {
  const counts = Object.fromEntries(PROJECT_STATUSES.map((s) => [s, 0])) as Record<ProjectStatus, number>;
  for (const p of projects) if (p.status in counts) counts[p.status as ProjectStatus] += 1;
  return counts;
}
