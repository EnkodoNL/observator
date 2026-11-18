// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { z } from "zod";
import { packageAdvice } from "@/lib/advice";
import { listChannels, toView } from "@/lib/data/channels";
import { listIngestKeys } from "@/lib/data/ingest-keys";
import { runtimeOverview } from "@/lib/data/runtime-overview";
import { listPackages, PACKAGE_SCOPES, packageDetail } from "@/lib/data/packages";
import { isKeyless, listProjects } from "@/lib/data/projects";
import { getProjectView } from "@/lib/data/views";
import { analyzeDockerfile } from "@/lib/dockerfile";
import { appId } from "@/lib/app-board";
import { appBadge, appBadgeToken, projectBadge } from "@/lib/badges";
import { DEFAULT_REPORTER_IMAGE } from "@/lib/snippet";
import { snippetQuestions, type SnippetField } from "@/lib/snippet-fields";
import { parseNames } from "@/lib/domains/names";
import { parseFailOn } from "@/lib/ingest/request";
import { env } from "@/lib/env";
import { displayEntry } from "@/lib/ingest/allowlist";
import type { DesiredIssue } from "@/lib/issues/desired";
import { matchingIgnore } from "@/lib/issues/reconcile";
import type { VulnIssueData } from "@/lib/issues/types";
import { vulnVersions } from "@/lib/issues/types";
import { jobStates } from "@/lib/jobs/scheduler";
import { effectiveLabels, parseLabels } from "@/lib/labels";
import type { BuildChanges, ProjectRecord } from "@/lib/pb/types";
import { adminPb } from "@/lib/pb/admin";
import { loadEvaluators } from "@/lib/runtimes";
import { lineDescription, pinLine } from "@/lib/runtimes/labels";
import { getSettings } from "@/lib/settings";
import { severityRank } from "@/lib/severity";
import { defineTool, iso, projectRef, projectUrl, resolveProject, ToolError, type Tool } from "./tools";
import { describeRuntimes, listProjectSummaries, PROJECT_STATUSES } from "@/lib/project-list";
import { deployStatus } from "@/lib/deploys/coolify";
import { listApplications, listDatabases, listServices } from "@/lib/coolify/client";
import { resourceInventory } from "@/lib/coolify/inventory";
import { listServers, serverAccess } from "@/lib/coolify/servers";
import { listDomains, type WatchedDomain } from "@/lib/domains/data";
import { certPhase, registrationExpiry, registrationPhase } from "@/lib/domains/phase";

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

/** A watched domain as MCP shows it; `slugs` maps project ids to slugs. */
export function describeDomain(
  { domain, hosts }: WatchedDomain,
  settings: { domainWarnDays: number; domainUrgentDays: number },
  slugs: Map<string, string>,
  now = new Date(),
) {
  const limits = { warnDays: settings.domainWarnDays, urgentDays: settings.domainUrgentDays };
  return {
    name: domain.name,
    registration: {
      expiresAt: registrationExpiry(domain),
      enteredByHand: Boolean(domain.manualExpiresAt),
      lookup: domain.registration?.source ?? "not checked yet",
      error: domain.registration?.error ?? null,
      phase: registrationPhase(domain, limits, now),
      remindDaysAhead: domain.remindDays || null,
      note: domain.note || null,
    },
    hosts: hosts.map((h) => ({
      name: h.name,
      project: slugs.get(h.project) ?? null,
      from: h.sources ?? [],
      certificate: {
        expiresAt: h.cert?.expiresAt ?? null,
        issuer: h.cert?.issuer || null,
        error: h.cert?.error || null,
        unreachable: h.cert?.unreachable || null,
        phase: certPhase(h.cert, now),
      },
    })),
  };
}

export const readTools: Record<string, Tool> = {
  list_projects: defineTool({
    title: "List projects",
    description:
      "All projects with their status (ok, update = a runtime security or end-of-life update, vulnerable = open package advisories, unchecked = a build with nothing Observator can check, such as an unchecked runtime without a lockfile, none = no build yet), runtimes (such as node 22.11.0, go 1.26.2 or mariadb 11.8.9; Node.js, Go and servers such as MariaDB, PostgreSQL and Redis are checked), app version, advisory counts, labels and last build. Advisories in packages only dev dependencies pull in are counted under buildOnly and do not make a project vulnerable, unless the countDevDependencies setting is on. Start here.",
    input: z.object({
      labels: z
        .array(z.string())
        .optional()
        .describe('Only projects that have all of these labels, such as ["env:prod"]'),
      status: z.enum(PROJECT_STATUSES).optional(),
      query: z.string().max(100).optional().describe("Part of the name or slug"),
    }),
    run: async ({ labels, status, query }) => {
      const projects = await listProjectSummaries({ labels, status, query });
      return { count: projects.length, projects };
    },
  }),

  get_project: defineTool({
    title: "Project details",
    description:
      "One project: its runtimes with release line and the image to pin, open advisories with fix advice for its package manager (commands, overrides, resolutions), build-only advisories (in dev dependencies, not in the running image) separately, ignored advisories with their reason, labels, setup (with Coolify's deploys against the reports, when linked), the latest build, its domains (certificates and registrations, see list_domains), and README badges as Markdown (badge.app covers every project of the app and suits a repository's README; badge.project is this project or server alone). Badges are public through the token in their link; new tokens are made in the web UI.",
    input: z.object({ project: projectRef }),
    run: async ({ project: ref }) => {
      const found = await resolveProject(ref);
      const [view, evaluators] = await Promise.all([getProjectView(found.slug), loadEvaluators()]);
      if (!view) throw new ToolError(`Project ${ref} disappeared.`);
      const { project: p, latest, summary, issues, ignores } = view;
      const appUrl = env().APP_URL;
      const app = appId(p);
      const appToken = await appBadgeToken(app);
      const [watched, settings, deploys, resource] = await Promise.all([
        listDomains(),
        getSettings(),
        p.deployWebhookUrl ? deployStatus(p.id) : null,
        p.coolifyKind ? resourceInventory(p.id) : null,
      ]);
      const domains = watched
        .map((w) => ({ ...w, hosts: w.hosts.filter((h) => h.project === p.id) }))
        .filter((w) => w.hosts.length)
        .map((w) => describeDomain(w, settings, new Map([[p.id, p.slug]])));
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
      const buildOnlyIds = new Set(summary.buildOnly.map((i) => i.id));
      const open = vulns.filter((i) => i.status === "open" && !buildOnlyIds.has(i.id));
      const buildOnly = vulns.filter((i) => buildOnlyIds.has(i.id));
      const ignored = vulns.filter((i) => i.status === "ignored");
      return {
        slug: p.slug,
        name: p.name,
        url: projectUrl(p.slug),
        status: summary.status,
        labels: { own: p.labels ?? [], fromBuild: p.buildLabels ?? [], all: effectiveLabels(p) },
        domains,
        badge: {
          app: appBadge(appUrl, app, appToken).markdown,
          project: projectBadge(appUrl, p).markdown,
        },
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
        buildOnly: capped(
          buildOnly.map((i) => ({
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
        // A Coolify database or service: its images as read from the registry. versionNow is what a
        // moving tag points to now; what runs can be older until Coolify pulls it again.
        coolifyResource: p.coolifyKind
          ? {
              kind: p.coolifyKind,
              type: resource?.type ?? null,
              server: resource?.server ?? null,
              syncedAt: resource?.syncedAt ?? null,
              goneAt: p.coolifyGoneAt || null,
              images: (resource?.images ?? []).map((i) => ({
                part: i.part || null,
                image: i.ref,
                pinned: i.pinned,
                product: i.product,
                version: i.version,
                versionNow: i.versionNow,
                runtimes: i.runtimes,
                source: i.source,
                error: i.error,
              })),
              // Apps by their GitHub repository: the version checked (assumed for a moving tag),
              // the newest release, and advisories whose range could not be read.
              apps: resource?.apps ?? [],
              // Coolify's own image scan: fixable findings are advisories, the rest is counted.
              scan: resource?.scan ?? null,
            }
          : null,
        setup: {
          apiKeyPrefix: p.ingestKey || isKeyless(p) ? null : p.apiKeyPrefix,
          sharedKey: Boolean(p.ingestKey),
          reportedName: p.sourceName || null,
          server: p.instance || null,
          deployWebhook: p.deployWebhookUrl ? { method: p.deployWebhookMethod || "POST" } : null,
          coolify: p.coolifyUuid
            ? {
                uuid: p.coolifyUuid,
                // false: no connected Coolify server has this application (yet).
                linked: Boolean(p.coolifyServer),
                source: p.coolifyKind ? "sync" : p.coolifySource || "picked",
              }
            : null,
          // Coolify's deploys against the reports (a token with read permission): no deploy since
          // the last report means nothing to worry about; unreported means the snippet did not run.
          deploys: deploys
            ? {
                checkedAt: deploys.checkedAt,
                lastDeployAt: deploys.lastDeployAt,
                unreported: deploys.unreported,
                error: deploys.error,
              }
            : null,
        },
      };
    },
  }),

  list_coolify_applications: defineTool({
    title: "Coolify applications, databases and services",
    description:
      "What the Coolify servers connected under Settings → Coolify run: applications (name, uuid, domains, build pack), to link a project with update_project's coolify (Dockerfile apps link themselves through COOLIFY_RESOURCE_UUID in their build; Docker Compose apps need this), and databases and services with their image and the project Observator keeps for each (synced every hour, no snippet).",
    input: z.object({}),
    run: async () => {
      const pb = await adminPb();
      const [servers, synced] = await Promise.all([
        listServers(),
        pb.collection("projects").getFullList<ProjectRecord>({
          filter: 'coolifyKind != ""',
          fields: "slug,coolifyServer,coolifyUuid,coolifyKind",
        }),
      ]);
      const projectOf = (server: string, uuid: string) =>
        synced.find((p) => p.coolifyServer === server && p.coolifyUuid === uuid)?.slug ?? null;
      const applications: {
        server: string;
        uuid: string;
        name: string;
        domains: string[];
        buildPack: string;
      }[] = [];
      const databases: {
        server: string;
        uuid: string;
        name: string;
        kind: string;
        image: string;
        project: string | null;
      }[] = [];
      const services: { server: string; uuid: string; name: string; type: string; project: string | null }[] =
        [];
      const errors: string[] = [];
      for (const server of servers) {
        const access = serverAccess(server);
        if (!access) {
          errors.push(`${server.name}: no token, or SECRETS_KEY changed`);
          continue;
        }
        const [apps, dbs, svcs] = await Promise.all([
          listApplications(access),
          listDatabases(access),
          listServices(access),
        ]);
        if ("error" in apps) errors.push(`${server.name}: ${apps.error}`);
        else applications.push(...apps.map((a) => ({ server: server.name, ...a })));
        if (!("error" in dbs))
          databases.push(
            ...dbs.map((d) => ({ server: server.name, ...d, project: projectOf(server.id, d.uuid) })),
          );
        if (!("error" in svcs))
          services.push(
            ...svcs.map((v) => ({ server: server.name, ...v, project: projectOf(server.id, v.uuid) })),
          );
      }
      return {
        servers: servers.length,
        applications,
        databases,
        services,
        errors,
        ...(servers.length === 0
          ? { hint: "No Coolify server is connected; add one in the web UI under Settings → Coolify." }
          : {}),
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
      "Every npm package in the projects' lockfiles and every Go module in their programs, one row per name: versions in use, number of projects and the worst open advisory. Vulnerable packages first.",
    input: z.object({
      query: z.string().max(512).optional().describe("Part of the package name"),
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
      name: z
        .string()
        .min(1)
        .max(512)
        .describe("The npm name or Go module path, such as lodash, @types/node or golang.org/x/net"),
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
      "All projects grouped per runtime and version. For checked runtimes (Node.js and Go): the release line, the security release to move to and the image to pin (for Go, in the stage that builds the program).",
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
              const pin = target ? pinLine(section.runtime, target, i.latest?.os ?? "") : null;
              return {
                slug: i.project.slug,
                name: i.project.name,
                os: i.latest?.os || null,
                pin,
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

  list_domains: defineTool({
    title: "Domains",
    description:
      "Watched domains: each registered domain's registration expiry (from the registry's RDAP, or a date entered by hand where the registry publishes none, such as .nl), its reminder and note, and its hosts with their TLS certificate and project. phase is ok, remind (the user's own reminder), warn, urgent or expired. Domains need no project.",
    input: z.object({ project: projectRef.optional().describe("Only domains with a host in this project") }),
    run: async ({ project: ref }) => {
      const [watched, settings, projects] = await Promise.all([listDomains(), getSettings(), listProjects()]);
      const only = ref ? await resolveProject(ref) : null;
      const names = new Map(projects.map((p) => [p.id, p.slug]));
      const shown = only ? watched.filter((w) => w.hosts.some((h) => h.project === only.id)) : watched;
      return { domains: shown.map((w) => describeDomain(w, settings, names)) };
    },
  }),

  get_settings: defineTool({
    title: "Settings and checks",
    description:
      "Stale days, reminders, digest schedule and domain warning days, plus when each background check last ran.",
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

  upgrade_observator: defineTool({
    title: "Upgrade Observator in a Dockerfile",
    description: [
      "Replaces the Observator snippet that is already in a Dockerfile with the current one, in the form you choose, and keeps what the old one was set to: the key, project, labels, domains, OBSERVATOR_FAIL_ON, the URL and keyless.",
      "It also checks for settings the snippet does not use yet. questions lists them, each with where the answer may be. Work out a suggestion from the repository, ask the user, and call again with the same dockerfile and the answers (domains, labels, failOn; an empty string means none, and stops the question). Write the returned dockerfile back as is once questions is empty.",
      "form image (default): the reporter binary from its image, a few lines, also for images without a shell. form shell: plain sh with curl, wget, node or python3, nothing pulled from a registry; for builds that cannot reach it, or teams that would rather not run a binary they did not build.",
      "For a Dockerfile without the snippet, use setup_dockerfile.",
    ].join("\n"),
    input: z.object({
      dockerfile: z.string().min(1).max(200_000).describe("The Dockerfile's full content"),
      path: z.string().max(500).optional().describe("Where the Dockerfile is, for the notes"),
      form: z.enum(["image", "shell"]).default("image"),
      domains: z.string().max(2000).optional().describe("Answer: comma-separated names the app is served on"),
      labels: z.string().max(2000).optional().describe("Answer: labels such as app:weather,role:web"),
      failOn: z.string().max(100).optional().describe("Answer: such as high, or critical,runtime"),
    }),
    run: async ({ dockerfile, path, form, ...answers }) => {
      const domains = parseNames(answers.domains ?? "");
      if (domains.invalid.length)
        throw new ToolError(`Not a domain or hostname: ${domains.invalid.join(", ")}`);
      const labels = parseLabels(answers.labels ?? "");
      if (labels.invalid.length) throw new ToolError(`Not a label: ${labels.invalid.join(", ")}`);
      const failOn = parseFailOn(answers.failOn ?? "");
      if (answers.failOn?.trim() && !failOn.severity && failOn.runtimes.length === 0)
        throw new ToolError(`Not a fail-on value: ${answers.failOn}`);

      const before = analyzeDockerfile(dockerfile, env().APP_URL);
      if (!before.ok) throw new ToolError(before.error);
      const old = before.existing;
      if (!old) throw new ToolError("This Dockerfile has no Observator snippet yet. Use setup_dockerfile.");
      // A reporter image of its own (a mirror) stays; otherwise the configured one.
      const image = old.image && old.image !== DEFAULT_REPORTER_IMAGE ? old.image : env().REPORTER_IMAGE;
      const set = {
        domains: answers.domains === undefined ? old.domains : domains.names.map((n) => n.host).join(","),
        labels: answers.labels === undefined ? old.labels : labels.labels.join(","),
        failOn: answers.failOn === undefined ? old.failOn : answers.failOn.trim(),
      };
      const a = analyzeDockerfile(dockerfile, old.url ?? env().APP_URL, {
        form,
        image,
        key: old.key,
        project: old.project,
        keyless: old.keyless,
        ...set,
      });
      if (!a.ok) throw new ToolError(a.error);
      const label = (f: string) => (f === "image" ? "the reporter image" : "plain sh");
      const notes = [
        {
          level: "ok" as const,
          text:
            old.form === form
              ? `Kept ${label(form)}, brought up to the current snippet.`
              : `Switched from ${label(old.form)} to ${label(form)}.`,
        },
        ...(form === "image" && old.form !== "image"
          ? [
              {
                level: "info" as const,
                text: `The build now pulls ${env().REPORTER_IMAGE}. Builds without access to that registry can override it with --build-context, or stay on form: shell.`,
              },
            ]
          : []),
        ...(old.url && old.url !== env().APP_URL
          ? [
              {
                level: "info" as const,
                text: `Kept OBSERVATOR_URL ${old.url}; this Observator runs at ${env().APP_URL}.`,
              },
            ]
          : []),
        ...(form === "image" && set.domains && !old.domains
          ? [
              {
                level: "info" as const,
                text: `Domains need reporter 1.1 or newer. If the build server has an older copy of ${image}, run docker pull ${image} there first; the build log warns when it is too old.`,
              },
            ]
          : []),
        ...a.notes.filter((n) => !n.text.startsWith("This Dockerfile already reports")),
      ];
      return {
        path: path ?? null,
        from: old.form,
        form,
        settings: {
          key: old.key ? `${old.key.slice(0, 8)}…` : null,
          project: old.project || null,
          labels: set.labels || null,
          domains: set.domains || null,
          failOn: set.failOn || null,
          keyless: old.keyless,
          url: old.url ?? null,
        },
        questions: snippetQuestions(
          old,
          (Object.keys(set) as SnippetField[]).filter((f) => answers[f] !== undefined),
        ),
        notes,
        dockerfile: `${a.lines.map((l) => l.text).join("\n")}\n`,
      };
    },
  }),
};
