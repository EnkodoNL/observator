// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CaretLeftIcon } from "@phosphor-icons/react/ssr";
import { DockerfileSetup } from "@/components/dockerfile-setup";
import { StatusBadge } from "@/components/status";
import { TabNav } from "@/components/tab-nav";
import { getProjectView } from "@/lib/data/views";
import { lastRedeploy, maskedWebhook } from "@/lib/deploy";
import { latestVersions, outdatedLevel } from "@/lib/npm-latest";
import { evaluateRuntimes, loadEvaluators } from "@/lib/runtimes";
import { env } from "@/lib/env";
import { vulnVersions, type VulnIssueData } from "@/lib/issues/types";
import type { Severity } from "@/lib/pb/types";
import { severityRank } from "@/lib/severity";
import { isDevVuln } from "@/lib/status";
import { appId, reportedName } from "@/lib/app-board";
import { appBadge, appBadgeToken, projectBadge } from "@/lib/badges";
import { BadgeRow } from "@/components/badge-row";
import { listProjects } from "@/lib/data/projects";
import type { IssueRecord } from "@/lib/pb/types";
import { timeAgo } from "@/lib/time";
import { ProjectActions } from "@/app/(app)/settings/projects/project-actions";
import { BuildsList } from "./builds-list";
import { RuntimePanel } from "./runtime-panel";
import { ProjectSettings } from "./project-settings";
import { RedeployButton } from "./redeploy-button";
import { PackagesTable, type PackageRow } from "./packages-table";
import { VulnList } from "./vuln-list";
import { IgnoreDialog, UnignoreButton } from "./ignore-dialog";
import { LabelsEditor } from "./labels-editor";
import { LabelChips } from "@/components/label-chips";
import { effectiveLabels, labelValue } from "@/lib/labels";
import { matchingIgnore } from "@/lib/issues/reconcile";
import type { DesiredIssue } from "@/lib/issues/desired";
import { formatDate } from "@/lib/time";
import { pbDate } from "@/lib/pb/admin";
import { requireUser } from "@/lib/auth/session";

const TABS = ["overview", "packages", "builds", "setup"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: PageProps<"/projects/[slug]">): Promise<Metadata> {
  return { title: (await params).slug };
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[slug]">) {
  await requireUser();
  const { slug } = await params;
  const query = await searchParams;
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : "overview";
  const [view, evaluators, latestByName, allProjects] = await Promise.all([
    getProjectView(slug),
    loadEvaluators(),
    latestVersions(),
    listProjects(),
  ]);
  if (!view) notFound();

  const { project, latest, summary, builds, components, issues } = view;
  const appUrl = env().APP_URL;
  // The app badge is worth showing once the app is more than this project.
  const app = {
    id: appId(project),
    name: labelValue(effectiveLabels(project), "app") ?? reportedName(project),
  };
  const appSize = allProjects.filter((p) => appId(p) === app.id).length;
  const appToken = appSize > 1 ? await appBadgeToken(app.id) : null;
  const evaluations = new Map(
    evaluateRuntimes(latest?.runtimes ?? [], evaluators).map((e) => [e.runtime, e] as const),
  );
  const redeploy = project.deployWebhookUrl ? await lastRedeploy(project.id) : null;
  const vulns = issues
    .filter((i) => i.kind === "vuln")
    .sort(
      (a, b) =>
        Number(a.status === "ignored") - Number(b.status === "ignored") ||
        severityRank(b.severity) - severityRank(a.severity),
    );
  const openVulns = vulns.filter((i) => i.status === "open");
  const prodVulns = vulns.filter((i) => !isDevVuln(i));
  const devVulns = vulns.filter(isDevVuln);
  /** "12 advisories in 1 package", for the open ones in a list. */
  const tally = (list: IssueRecord[]) => {
    const open = list.filter((i) => i.status === "open");
    const packages = new Set(open.map((v) => (v.data as unknown as VulnIssueData).package)).size;
    return open.length
      ? `${open.length} ${open.length === 1 ? "advisory" : "advisories"} in ${packages} ${packages === 1 ? "package" : "packages"}`
      : "";
  };
  const lockfile = latest?.lockfileType ?? "npm";
  const actions = (issue: IssueRecord) => {
    const d = issue.data as unknown as VulnIssueData;
    if (issue.status !== "ignored") {
      return (
        <IgnoreDialog projectId={project.id} projectName={project.name} osvId={d.osvId} pkg={d.package} />
      );
    }
    const ignore = matchingIgnore(issue as unknown as DesiredIssue, project.id, view.ignores, new Date());
    return ignore ? (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span title={ignore.reason}>
          Ignored{ignore.project ? "" : " everywhere"}
          {ignore.expiresAt ? ` until ${formatDate(pbDate(ignore.expiresAt))}` : ""}: {ignore.reason}
        </span>
        <UnignoreButton ignoreId={ignore.id} />
      </span>
    ) : null;
  };

  const vulnByPackage = new Map<string, { severity: Severity; count: number }>();
  for (const v of openVulns) {
    const d = v.data as unknown as VulnIssueData;
    for (const version of vulnVersions(d)) {
      const key = `${d.package}@${version}`;
      const prev = vulnByPackage.get(key);
      vulnByPackage.set(key, {
        severity:
          !prev || severityRank(v.severity) > severityRank(prev.severity) ? v.severity : prev.severity,
        count: (prev?.count ?? 0) + 1,
      });
    }
  }
  const rows: PackageRow[] = components.map((c) => {
    const v = vulnByPackage.get(`${c.name}@${c.version}`);
    return {
      name: c.name,
      version: c.version,
      direct: c.direct,
      dev: c.dev,
      via: c.via ?? [],
      severity: v?.severity ?? null,
      vulnCount: v?.count ?? 0,
      ...(c.direct
        ? { latest: latestByName[c.name], outdated: outdatedLevel(c.version, latestByName[c.name]) }
        : {}),
    };
  });

  const base = `/projects/${project.slug}`;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <CaretLeftIcon className="size-4" /> Overview
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h1 className="font-display text-3xl leading-tight font-bold tracking-tight">
                {reportedName(project)}
              </h1>
              <StatusBadge status={summary.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {view.lastBuildAt ? `Last build ${timeAgo(view.lastBuildAt)}` : "No builds yet"}
              {project.instance && (
                <>
                  {" "}
                  on <span className="font-mono text-foreground">{project.instance}</span>
                </>
              )}
              .
              {redeploy && (
                <span className={redeploy.ok ? undefined : "text-danger"} title={redeploy.message}>
                  {" "}
                  Last redeploy {timeAgo(new Date(redeploy.at))}
                  {!redeploy.ok && " failed"}.
                </span>
              )}
            </p>
            <LabelChips labels={effectiveLabels(project)} />
          </div>
          <div className="flex items-center gap-2">
            {project.deployWebhookUrl && (
              <RedeployButton projectId={project.id} name={project.name} target={maskedWebhook(project)} />
            )}
            <ProjectActions
              id={project.id}
              name={project.name}
              appUrl={appUrl}
              badge={projectBadge(appUrl, project).markdown}
            />
          </div>
        </div>
      </div>

      <TabNav
        base={base}
        active={tab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "packages", label: "Packages", count: components.length },
          { id: "builds", label: "Builds", count: builds.length },
          { id: "setup", label: "Setup" },
        ]}
      />

      {tab === "overview" && (
        <div className="space-y-6">
          <RuntimePanel latest={latest} summary={summary} evaluations={evaluations} />
          <section className="space-y-3" aria-labelledby="production">
            <h2 id="production" className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-display text-xl font-bold tracking-tight">In production</span>
              <span className="text-sm text-muted-foreground">{tally(prodVulns)}</span>
            </h2>
            <VulnList
              issues={prodVulns}
              lockfile={lockfile}
              actions={actions}
              empty={
                !latest
                  ? "Packages are checked after the first build reports."
                  : latest.lockfileType === "none"
                    ? "This project reports without a lockfile, so packages are not checked."
                    : !project.vulnsCheckedAt
                      ? "The package check has not run yet."
                      : devVulns.length
                        ? "No known vulnerabilities in the packages this project runs with."
                        : "No known vulnerabilities in the current packages."
              }
            />
          </section>
          {devVulns.length > 0 &&
            (view.countDev ? (
              <section className="space-y-3" aria-labelledby="dev">
                <h2 id="dev" className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-display text-xl font-bold tracking-tight">Dev dependencies</span>
                  <span className="text-sm text-muted-foreground">{tally(devVulns)}</span>
                </h2>
                <VulnList issues={devVulns} lockfile={lockfile} actions={actions} empty="" />
              </section>
            ) : (
              <details className="space-y-3">
                <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
                  <b className="font-display text-foreground">Build only</b>,{" "}
                  {tally(devVulns) || "all ignored"}
                </summary>
                <p className="max-w-[65ch] text-sm text-muted-foreground">
                  These packages come in through dev dependencies only, so an image installed without them
                  does not run them. They do not change the status or send notifications.{" "}
                  <Link href="/settings/general" className="text-primary underline-offset-4 hover:underline">
                    Count them anyway
                  </Link>
                </p>
                <VulnList issues={devVulns} lockfile={lockfile} actions={actions} quiet empty="" />
              </details>
            ))}
          <section className="space-y-3 border-t pt-6" aria-labelledby="badge">
            <h2 id="badge" className="font-display text-lg font-bold tracking-tight">
              Badge
            </h2>
            <p className="max-w-[65ch] text-sm text-muted-foreground">
              For a README. The link is public and shows the status only.{" "}
              <Link href="/settings/badges" className="text-primary underline-offset-4 hover:underline">
                All badges
              </Link>
            </p>
            {appToken ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm">
                    <b>{app.name}</b>{" "}
                    <span className="text-muted-foreground">as a whole, {appSize} projects</span>
                  </p>
                  <BadgeRow
                    name={app.name}
                    links={appBadge(appUrl, app.id, appToken)}
                    target={{ kind: "app", id: app.id }}
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">This project only</p>
                  <BadgeRow
                    name={project.name}
                    links={projectBadge(appUrl, project)}
                    target={{ kind: "project", id: project.id }}
                  />
                </div>
              </div>
            ) : (
              <BadgeRow
                name={project.name}
                links={projectBadge(appUrl, project)}
                target={{ kind: "project", id: project.id }}
              />
            )}
          </section>
        </div>
      )}

      {tab === "packages" &&
        (components.length === 0 ? (
          <p className="text-sm text-muted-foreground">No packages recorded yet.</p>
        ) : (
          <PackagesTable rows={rows} />
        ))}

      {tab === "builds" && <BuildsList builds={builds} />}

      {tab === "setup" && (
        <div className="max-w-3xl space-y-6">
          <section className="space-y-2">
            <h2 className="font-medium">Dockerfile</h2>
            <p className="text-sm text-muted-foreground">
              The snippet contains no secrets, so it is safe to commit.
            </p>
            <DockerfileSetup url={appUrl} />
          </section>
          <section className="space-y-2">
            <h2 className="font-medium">API key</h2>
            {project.ingestKey ? (
              <p className="text-sm text-muted-foreground">
                Created by a shared key. It reports with that key and{" "}
                <code className="font-mono text-foreground">OBSERVATOR_PROJECT={project.sourceName}</code>
                {project.instance && (
                  <>
                    {" "}
                    from <code className="font-mono text-foreground">{project.instance}</code>
                  </>
                )}
                . To give it a key of its own, rotate it from the menu at the top right.
              </p>
            ) : project.apiKeyPrefix === "self" ? (
              <p className="text-sm text-muted-foreground">
                This is Observator itself. It reports the Node.js version and packages it runs with at startup
                and once a day, without a key. Set{" "}
                <code className="font-mono text-foreground">OBSERVATOR_SELF=off</code> to stop.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pass it as build argument <code className="font-mono text-foreground">OBSERVATOR_KEY</code>{" "}
                (in Coolify: an environment variable with &ldquo;Build Variable&rdquo; ticked). The current
                key starts with <code className="font-mono text-foreground">{project.apiKeyPrefix}</code>.
                Lost it? Rotate it from the menu at the top right.
              </p>
            )}
          </section>
          <section className="space-y-2">
            <h2 className="font-medium">Status badge</h2>
            <p className="text-sm text-muted-foreground">
              At the bottom of the{" "}
              <Link
                href={`/projects/${project.slug}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                overview
              </Link>
              , and for every app under{" "}
              <Link href="/settings/badges" className="text-primary underline-offset-4 hover:underline">
                Settings → Badges
              </Link>
              .
            </p>
          </section>
          <section className="space-y-2">
            <h2 className="font-medium">Labels</h2>
            <p className="text-sm text-muted-foreground">
              For grouping and filtering on the overview, such as{" "}
              <code className="font-mono">app:heatwave</code> or <code className="font-mono">env:prod</code>.
              The build can add its own with <code className="font-mono">OBSERVATOR_LABELS</code>; the project
              shows both.
            </p>
            <LabelsEditor
              projectId={project.id}
              labels={project.labels ?? []}
              buildLabels={project.buildLabels ?? []}
            />
          </section>
          <section className="space-y-3">
            <h2 className="font-medium">Project</h2>
            <ProjectSettings
              projectId={project.id}
              name={project.name}
              webhook={{
                masked: maskedWebhook(project),
                method: project.deployWebhookMethod || "POST",
                hasToken: Boolean(project.deployWebhookToken),
              }}
            />
          </section>
          <section className="space-y-2">
            <h2 className="font-medium">Build gate (optional)</h2>
            <p className="text-sm text-muted-foreground">
              Set <code className="font-mono text-foreground">OBSERVATOR_FAIL_ON</code> to{" "}
              <code className="font-mono text-foreground">critical</code>,{" "}
              <code className="font-mono text-foreground">high</code>, and add{" "}
              <code className="font-mono text-foreground">runtime</code> or a runtime name such as{" "}
              <code className="font-mono text-foreground">node</code> (for example{" "}
              <code className="font-mono text-foreground">high,node</code>) to fail the build when Observator
              knows about such a problem: an advisory at that level in production, or a runtime security
              update. Unset, a build never fails because of Observator.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
