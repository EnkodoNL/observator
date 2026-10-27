// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { z } from "zod";
import { packageAdvice } from "@/lib/advice";
import { listChannels, toView } from "@/lib/data/channels";
import { listIngestKeys } from "@/lib/data/ingest-keys";
import { runtimeOverview } from "@/lib/data/runtime-overview";
import { listPackages, PACKAGE_SCOPES, packageDetail } from "@/lib/data/packages";
import { listProjects } from "@/lib/data/projects";
import { getOverview, getProjectView } from "@/lib/data/views";
import { analyzeDockerfile } from "@/lib/dockerfile";
import { env } from "@/lib/env";
import { displayEntry } from "@/lib/ingest/allowlist";
import type { DesiredIssue } from "@/lib/issues/desired";
import { matchingIgnore } from "@/lib/issues/reconcile";
import type { RuntimeEolData, RuntimeSecurityData, VulnIssueData } from "@/lib/issues/types";
import { vulnVersions } from "@/lib/issues/types";
import { jobStates } from "@/lib/jobs/scheduler";
import { effectiveLabels, hasLabels } from "@/lib/labels";
import type { BuildChanges, BuildRecord, IssueRecord } from "@/lib/pb/types";
import { loadEvaluators } from "@/lib/runtimes";
import { CHECKED_RUNTIMES, lineDescription, pinFor, runtimeLabel } from "@/lib/runtimes/labels";
import type { Evaluator } from "@/lib/runtimes/types";
import { getSettings } from "@/lib/settings";
import { severityRank } from "@/lib/severity";
import { isStale } from "@/lib/status";
import { defineTool, iso, projectRef, projectUrl, resolveProject, ToolError, type Tool } from "./tools";

const STATUSES = ["none", "ok", "update", "vulnerable"] as const;

/** At most `n` entries of a list, saying how many were left out. */
function capped<T>(list: T[], n: number): { items: T[]; omitted: number } {
  return { items: list.slice(0, n), omitted: Math.max(0, list.length - n) };
}

function compactChanges(c: BuildChanges | null) {
  if (!c) return null;
  return {
    runtimes: c.runtimes ?? [],
    app: c.app ?? null,
    added: capped(c.added, 50),
    removed: capped(c.removed, 50),
    changed: capped(c.changed, 50),
    truncated: Boolean(c.truncated),
  };
}

/**
 * The runtimes of a build with what Observator knows about each: the release line, an open
 * security update with the image to pin, end of life. Unchecked runtimes are listed as such.
 */
function describeRuntimes(
  build: Pick<BuildRecord, "runtimes" | "os"> | null,
  issues: { security: IssueRecord[]; eol: IssueRecord[] },
  evaluators?: Map<string, Evaluator>,
) {
  return (build?.runtimes ?? []).map((r) => {
    const security = issues.security
      .map((i) => i.data as unknown as RuntimeSecurityData)
      .find((d) => d.runtime === r.name);
    const eol = issues.eol.map((i) => i.data as unknown as RuntimeEolData).find((d) => d.runtime === r.name);
    const pin = security ? pinFor(r.name, security.target, security.os) : null;
    return {
      name: r.name,
      label: runtimeLabel(r.name),
      version: r.version,
      checked: CHECKED_RUNTIMES.includes(r.name),
      ...(evaluators ? { line: lineDescription(evaluators.get(r.name)?.(r.version) ?? null) } : {}),
      securityUpdate: security
        ? { target: security.target, ...(pin ? { pin: `FROM ${pin} AS app` } : {}) }
        : null,
      endOfLife: eol ? { phase: eol.phase, end: eol.end } : null,
    };
  });
}

export const readTools: Record<string, Tool> = {
  list_projects: defineTool({
    title: "List projects",
    description:
      "All projects with their status (ok, update = a runtime security or end-of-life update, vulnerable = open package advisories, none = no build yet), runtimes (such as node 22.11.0; only Node.js is checked so far), app version, advisory counts, labels and last build. Start here.",
    input: z.object({
      labels: z
        .array(z.string())
        .optional()
        .describe('Only projects that have all of these labels, such as ["env:prod"]'),
      status: z.enum(STATUSES).optional(),
      query: z.string().max(100).optional().describe("Part of the name or slug"),
    }),
    run: async ({ labels, status, query }) => {
      const [items, settings, keys] = await Promise.all([getOverview(), getSettings(), listIngestKeys()]);
      const keyName = new Map(keys.map((k) => [k.id, k.name]));
      const q = query?.trim().toLowerCase();
      const projects = items
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
          stale: isStale(summary, lastBuildAt, settings.staleDays),
          labels: effectiveLabels(p),
          runtimes: describeRuntimes(latest, { security: summary.runtimeSecurity, eol: summary.runtimeEol }),
          app: latest?.appVersion ? { name: latest.appName, version: latest.appVersion } : null,
          advisories: summary.vulnBySeverity,
          lastBuild: lastBuildAt?.toISOString() ?? null,
          sharedKey: p.ingestKey ? (keyName.get(p.ingestKey) ?? "revoked") : null,
          server: p.instance || null,
        }));
      return { count: projects.length, projects };
    },
  }),

  get_project: defineTool({
    title: "Project details",
    description:
      "One project: its runtimes with release line and the image to pin, open advisories with fix advice for its package manager (commands, overrides, resolutions), ignored advisories with their reason, labels, setup and the latest build.",
    input: z.object({ project: projectRef }),
    run: async ({ project: ref }) => {
      const found = await resolveProject(ref);
      const [view, evaluators] = await Promise.all([getProjectView(found.slug), loadEvaluators()]);
      if (!view) throw new ToolError(`Project ${ref} disappeared.`);
      const { project: p, latest, summary, issues, ignores } = view;
      const lockfile = latest?.lockfileType && latest.lockfileType !== "none" ? latest.lockfileType : "npm";
      const vulns = issues
        .filter((i) => i.kind === "vuln")
        .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
      const advisory = (i: (typeof vulns)[number]) => {
        const d = i.data as unknown as VulnIssueData;
        return {
          osvId: d.osvId,
          aliases: d.aliases,
          package: d.package,
          versions: vulnVersions(d),
          severity: i.severity,
          summary: d.summary,
          fixedIn: d.fixedIn || null,
          url: d.url,
          direct: d.direct,
          dev: d.dev,
          via: d.via,
        };
      };
      const open = vulns.filter((i) => i.status === "open");
      const ignored = vulns.filter((i) => i.status === "ignored");
      return {
        slug: p.slug,
        name: p.name,
        url: projectUrl(p.slug),
        status: summary.status,
        labels: { own: p.labels ?? [], fromBuild: p.buildLabels ?? [], all: effectiveLabels(p) },
        runtimes: describeRuntimes(
          latest,
          { security: summary.runtimeSecurity, eol: summary.runtimeEol },
          evaluators,
        ),
        app: latest?.appVersion ? { name: latest.appName, version: latest.appVersion } : null,
        platform: latest ? [latest.platform, latest.arch].filter(Boolean).join("/") || null : null,
        os: latest?.os || null,
        advisories: capped(
          open.map((i) => ({
            ...advisory(i),
            advice: packageAdvice(i.data as unknown as VulnIssueData, lockfile),
          })),
          100,
        ),
        ignored: ignored.map((i) => {
          // The stored issue carries what matching needs (kind, key, data), as on the project page.
          const ig = matchingIgnore(i as unknown as DesiredIssue, p.id, ignores, new Date());
          return {
            ...advisory(i),
            ignoreId: ig?.id ?? null,
            reason: ig?.reason ?? null,
            expiresAt: iso(ig?.expiresAt),
            scope: ig ? (ig.project ? "project" : "all projects") : null,
          };
        }),
        latestBuild: latest
          ? {
              at: iso(latest.created),
              lockfile: latest.lockfileType,
              packages: latest.packageCount,
              from: latest.sourceIp || null,
              error: latest.error || null,
            }
          : null,
        setup: {
          apiKeyPrefix: p.ingestKey || p.apiKeyPrefix === "self" ? null : p.apiKeyPrefix,
          sharedKey: Boolean(p.ingestKey),
          reportedName: p.sourceName || null,
          server: p.instance || null,
          deployWebhook: p.deployWebhookUrl ? { method: p.deployWebhookMethod || "GET" } : null,
        },
      };
    },
  }),

  list_builds: defineTool({
    title: "Build history",
    description:
      "A project's latest builds, newest first, with what changed in each: runtime versions, the app version from package.json, and added, removed and changed packages.",
    input: z.object({ project: projectRef, limit: z.number().int().min(1).max(50).default(10) }),
    run: async ({ project: ref, limit }) => {
      const view = await getProjectView((await resolveProject(ref)).slug);
      if (!view) throw new ToolError(`Project ${ref} disappeared.`);
      return {
        builds: view.builds.slice(0, limit).map((b) => ({
          at: iso(b.created),
          runtimes: b.runtimes ?? [],
          app: b.appVersion ? { name: b.appName, version: b.appVersion } : null,
          platform: [b.platform, b.arch].filter(Boolean).join("/") || null,
          os: b.os || null,
          lockfile: b.lockfileType,
          packages: b.packageCount,
          from: b.sourceIp || null,
          error: b.error || null,
          changes: compactChanges(b.changes),
        })),
      };
    },
  }),

  list_packages: defineTool({
    title: "Packages across projects",
    description:
      "Every npm package in the projects' lockfiles, one row per name: versions in use, number of projects and the worst open advisory. Vulnerable packages first.",
    input: z.object({
      query: z.string().max(214).optional().describe("Part of the package name"),
      scope: z.enum(PACKAGE_SCOPES).default("direct"),
      limit: z.number().int().min(1).max(200).default(100),
    }),
    run: async ({ query, scope, limit }) => {
      const { packages, counts } = await listPackages(query ?? "", scope);
      return { counts, ...capped(packages, limit) };
    },
  }),

  get_package: defineTool({
    title: "Package details",
    description:
      "Where one package is used: per project the version, whether it is direct or pulled in by another package, and the advisories that apply.",
    input: z.object({
      name: z.string().min(1).max(214).describe("The npm name, such as lodash or @types/node"),
    }),
    run: async ({ name }) => {
      const detail = await packageDetail(name);
      if (!detail) throw new ToolError(`No project uses a package called ${name}.`);
      return { ...detail };
    },
  }),

  runtime_overview: defineTool({
    title: "Runtime versions",
    description:
      "All projects grouped per runtime and version. For checked runtimes (Node.js so far): the release line, the security release to move to and the image to pin.",
    input: z.object({}),
    run: async () => ({
      runtimes: (await runtimeOverview()).map((section) => ({
        runtime: section.runtime,
        label: section.label,
        checked: section.checked,
        affected: section.affected,
        targets: section.targets,
        versions: section.versions.map((g) => {
          const target = g.evaluation?.securityUpdate?.target ?? null;
          return {
            version: g.version,
            line: lineDescription(g.evaluation),
            securityUpdate: target,
            projects: g.projects.map((i) => {
              const pin = target ? pinFor(section.runtime, target, i.latest?.os ?? "") : null;
              return {
                slug: i.project.slug,
                name: i.project.name,
                os: i.latest?.os || null,
                pin: pin ? `FROM ${pin} AS app` : null,
              };
            }),
          };
        }),
      })),
    }),
  }),

  list_shared_keys: defineTool({
    title: "Shared keys",
    description:
      "Write-only keys that create projects on their first report, with their IP allowlists (builds from those addresses may report without a key).",
    input: z.object({}),
    run: async () => ({
      keys: (await listIngestKeys()).map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.keyPrefix,
        onePerServer: k.splitByIp,
        projects: k.projects,
        lastUsed: iso(k.lastUsedAt),
        lastUsedFrom: k.lastUsedIp || null,
        allowlist: (k.allowedIps ?? []).map((e) => ({ address: displayEntry(e.cidr), note: e.note })),
      })),
    }),
  }),

  get_settings: defineTool({
    title: "Settings and checks",
    description: "Stale days, reminders and digest schedule, plus when each background check last ran.",
    input: z.object({}),
    run: async () => {
      const [settings, jobs] = await Promise.all([getSettings(), jobStates()]);
      return { settings, jobs };
    },
  }),

  list_channels: defineTool({
    title: "Notification channels",
    description: "Where notifications go. Secret fields are never shown, only whether they are set.",
    input: z.object({}),
    run: async () => {
      const [channels, projects] = await Promise.all([listChannels(), listProjects()]);
      const slug = new Map(projects.map((p) => [p.id, p.slug]));
      return {
        channels: channels.map((c) => {
          const v = toView(c);
          return { ...v, projects: v.projects.map((id) => slug.get(id) ?? id) };
        }),
      };
    },
  }),

  analyze_dockerfile: defineTool({
    title: "Check a Dockerfile",
    description:
      "Reads a Dockerfile and returns it with the Observator snippet added, without a key, plus a note per decision (stage name, whether the base image can run it, where the lockfile comes from). setup_dockerfile does the same and can also create a project and fill in its key.",
    input: z.object({
      dockerfile: z.string().min(1).max(200_000),
      keyless: z
        .boolean()
        .optional()
        .describe("The snippet without the key check, for servers on an IP allowlist"),
      form: z
        .enum(["image", "shell"])
        .default("image")
        .describe(
          "image (default): a few lines that copy the reporter from its image, also for images without a shell. shell: plain sh, nothing to pull, for builds that cannot reach the registry.",
        ),
    }),
    run: async ({ dockerfile, keyless, form }) => {
      const a = analyzeDockerfile(dockerfile, env().APP_URL, { keyless, form, image: env().REPORTER_IMAGE });
      if (!a.ok) throw new ToolError(a.error);
      return {
        form,
        stage: a.stage,
        lockfileFrom: a.lockfileFrom ?? null,
        notes: a.notes,
        dockerfile: `${a.lines.map((l) => l.text).join("\n")}\n`,
      };
    },
  }),
};
