// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { DockerfileSetup } from "@/components/dockerfile-setup";
import { StatusBadge } from "@/components/status";
import { TabNav } from "@/components/tab-nav";
import { getProjectView } from "@/lib/data/views";
import { lastRedeploy, maskUrl } from "@/lib/deploy";
import { latestVersions, outdatedLevel } from "@/lib/npm-latest";
import { evaluateRuntimes, loadEvaluators } from "@/lib/runtimes";
import { env } from "@/lib/env";
import { vulnVersions, type VulnIssueData } from "@/lib/issues/types";
import type { Severity } from "@/lib/pb/types";
import { severityRank } from "@/lib/severity";
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
import { effectiveLabels } from "@/lib/labels";
import { matchingIgnore } from "@/lib/issues/reconcile";
import type { DesiredIssue } from "@/lib/issues/desired";
import { formatDate } from "@/lib/time";
import { pbDate } from "@/lib/pb/admin";

const TABS = ["overview", "packages", "builds", "setup"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: PageProps<"/projects/[slug]">): Promise<Metadata> {
  return { title: (await params).slug };
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[slug]">) {
  const { slug } = await params;
  const query = await searchParams;
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : "overview";
  const [view, evaluators, latestByName] = await Promise.all([
    getProjectView(slug),
    loadEvaluators(),
    latestVersions(),
  ]);
  if (!view) notFound();

  const { project, latest, summary, builds, components, issues } = view;
  const appUrl = env().APP_URL;
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
          <ChevronLeftIcon className="size-4" /> Overview
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
              <StatusBadge status={summary.status} />
            </div>
            <LabelChips labels={effectiveLabels(project)} className="mt-2" />
            <p className="mt-1 text-sm text-muted-foreground">
              {view.lastBuildAt ? `Last build ${timeAgo(view.lastBuildAt)}` : "No builds yet"} ·{" "}
              <span className="font-mono">{project.slug}</span>
              {redeploy && (
                <>
                  {" · "}
                  <span className={redeploy.ok ? undefined : "text-danger"} title={redeploy.message}>
                    last redeploy {timeAgo(new Date(redeploy.at))}
                    {!redeploy.ok && " failed"}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {project.deployWebhookUrl && (
              <RedeployButton
                projectId={project.id}
                name={project.name}
                target={maskUrl(project.deployWebhookUrl)}
              />
            )}
            <ProjectActions id={project.id} name={project.name} appUrl={appUrl} />
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
          <section className="space-y-3">
            <h2 className="font-medium">
              Vulnerabilities{" "}
              {openVulns.length > 0 && (
                <span className="text-muted-foreground tabular-nums">{openVulns.length}</span>
              )}
            </h2>
            <VulnList
              issues={vulns}
              lockfile={latest?.lockfileType ?? "npm"}
              actions={(issue) => {
                const d = issue.data as unknown as VulnIssueData;
                if (issue.status !== "ignored") {
                  return (
                    <IgnoreDialog
                      projectId={project.id}
                      projectName={project.name}
                      osvId={d.osvId}
                      pkg={d.package}
                    />
                  );
                }
                const ignore = matchingIgnore(
                  issue as unknown as DesiredIssue,
                  project.id,
                  view.ignores,
                  new Date(),
                );
                return ignore ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span title={ignore.reason}>
                      Ignored{ignore.project ? "" : " everywhere"}
                      {ignore.expiresAt ? ` until ${formatDate(pbDate(ignore.expiresAt))}` : ""}:{" "}
                      {ignore.reason}
                    </span>
                    <UnignoreButton ignoreId={ignore.id} />
                  </span>
                ) : null;
              }}
              empty={
                !latest
                  ? "Packages are checked after the first build reports."
                  : latest.lockfileType === "none"
                    ? "This project reports without a lockfile, so packages are not checked."
                    : project.vulnsCheckedAt
                      ? "No known vulnerabilities in the current packages."
                      : "The package check has not run yet."
              }
            />
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
              For a README. The token only grants this badge; it shows{" "}
              <code className="font-mono">unknown</code> without it.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/badge/${project.slug}.svg?token=${project.badgeToken}`}
              alt="Observator status"
              height={20}
            />
            <CodeBlock
              code={`[![Observator](${appUrl}/badge/${project.slug}.svg?token=${project.badgeToken})](${appUrl}/projects/${project.slug})`}
            />
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
                masked: maskUrl(project.deployWebhookUrl),
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
              knows about such a problem: an advisory at that level, or a runtime security update. Unset, a
              build never fails because of Observator.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
