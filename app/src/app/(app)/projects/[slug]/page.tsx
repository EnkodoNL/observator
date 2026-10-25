// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { SnippetTabs } from "@/components/snippet-tabs";
import { StatusBadge } from "@/components/status";
import { TabNav } from "@/components/tab-nav";
import { getProjectView } from "@/lib/data/views";
import { lastRedeploy, maskUrl } from "@/lib/deploy";
import { latestVersions, outdatedLevel } from "@/lib/npm-latest";
import { evaluateNode } from "@/lib/node/evaluate";
import { getNodeData } from "@/lib/node/releases";
import { env } from "@/lib/env";
import { vulnVersions, type VulnIssueData } from "@/lib/issues/types";
import type { Severity } from "@/lib/pb/types";
import { severityRank } from "@/lib/severity";
import { timeAgo } from "@/lib/time";
import { ProjectActions } from "@/app/(app)/settings/projects/project-actions";
import { BuildsList } from "./builds-list";
import { NodePanel } from "./node-panel";
import { ProjectSettings } from "./project-settings";
import { RedeployButton } from "./redeploy-button";
import { PackagesTable, type PackageRow } from "./packages-table";
import { VulnList } from "./vuln-list";
import { IgnoreDialog, UnignoreButton } from "./ignore-dialog";
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
  const [view, nodeData, latestByName] = await Promise.all([
    getProjectView(slug),
    getNodeData(),
    latestVersions(),
  ]);
  if (!view) notFound();

  const { project, latest, summary, builds, components, issues } = view;
  const appUrl = env().APP_URL;
  const evaluation = latest && nodeData ? evaluateNode(latest.nodeVersion, nodeData) : null;
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
          <NodePanel latest={latest} summary={summary} evaluation={evaluation} />
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
              Add this to the end of the Dockerfile and name the final stage{" "}
              <code className="font-mono text-foreground">app</code>. It contains no secrets.
            </p>
            <SnippetTabs url={appUrl} />
          </section>
          <section className="space-y-2">
            <h2 className="font-medium">API key</h2>
            <p className="text-sm text-muted-foreground">
              Pass it as build argument <code className="font-mono text-foreground">OBSERVATOR_KEY</code> (in
              Coolify: an environment variable with &ldquo;Build Variable&rdquo; ticked). The current key
              starts with <code className="font-mono text-foreground">{project.apiKeyPrefix}</code>. Lost it?
              Rotate it from the menu at the top right.
            </p>
          </section>
          <section className="space-y-2">
            <h2 className="font-medium">Status badge</h2>
            <p className="text-sm text-muted-foreground">
              For a README. The token only grants this badge; it shows <code className="font-mono">unknown</code> without it.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/badge/${project.slug}.svg?token=${project.badgeToken}`} alt="Observator status" height={20} />
            <CodeBlock
              code={`[![Observator](${appUrl}/badge/${project.slug}.svg?token=${project.badgeToken})](${appUrl}/projects/${project.slug})`}
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
              <code className="font-mono text-foreground">high</code>, or add{" "}
              <code className="font-mono text-foreground">node</code> (for example{" "}
              <code className="font-mono text-foreground">high,node</code>) to fail the build when Observator
              knows about such a problem. Unset, a build never fails because of Observator.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
