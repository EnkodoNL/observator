// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listIngestKeys, listRefused } from "@/lib/data/ingest-keys";
import { listProjects } from "@/lib/data/projects";
import { env } from "@/lib/env";
import { pbDate } from "@/lib/pb/admin";
import { timeAgo } from "@/lib/time";
import { NewProjectDialog } from "./new-project-dialog";
import { ProjectActions } from "./project-actions";
import { NewSharedKeyDialog, SharedKeyList } from "./shared-keys";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsSettingsPage() {
  const [projects, keys] = await Promise.all([listProjects(), listIngestKeys()]);
  const refused = await listRefused(keys);
  const appUrl = env().APP_URL;
  const keyName = new Map(keys.map((k) => [k.id, k.name]));

  return (
    <div className="space-y-10">
      <section>
        <PageHeader
          title="Projects"
          description="Builds report from a Dockerfile stage, with the project's own key or a shared key."
          actions={<NewProjectDialog appUrl={appUrl} />}
        />
        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <p className="font-medium">No projects yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create one, add the snippet to its Dockerfile, and the next build shows up here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Last build</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={`/projects/${p.slug}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{p.slug}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.ingestKey ? (
                        <span>shared: {keyName.get(p.ingestKey) ?? "revoked"}</span>
                      ) : p.apiKeyPrefix === "self" ? (
                        <span>reports itself</span>
                      ) : (
                        <span className="font-mono">{p.apiKeyPrefix}…</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{timeAgo(pbDate(p.lastBuildAt))}</TableCell>
                    <TableCell>
                      <ProjectActions id={p.id} name={p.name} appUrl={appUrl} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      <section>
        <PageHeader
          title="Shared keys"
          description="One write-only key for many apps. Each build names its project with OBSERVATOR_PROJECT (or package.json) and the project is created on its first report."
          actions={<NewSharedKeyDialog appUrl={appUrl} />}
        />
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shared keys yet.</p>
        ) : (
          <SharedKeyList
            appUrl={appUrl}
            refused={refused.map((r) => ({
              ip: r.ip,
              project: r.project,
              reason: r.reason ?? "no key",
              count: r.count,
              when: timeAgo(pbDate(r.lastAt)),
            }))}
            keys={keys.map((k) => ({
              id: k.id,
              name: k.name,
              prefix: k.keyPrefix,
              splitByIp: k.splitByIp,
              projects: k.projects,
              lastUsed: k.lastUsedAt ? timeAgo(pbDate(k.lastUsedAt)) : "",
              lastUsedIp: k.lastUsedIp,
              allowedIps: k.allowedIps ?? [],
            }))}
          />
        )}
      </section>
    </div>
  );
}
