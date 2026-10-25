// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listProjects } from "@/lib/data/projects";
import { env } from "@/lib/env";
import { pbDate } from "@/lib/pb/admin";
import { timeAgo } from "@/lib/time";
import { NewProjectDialog } from "./new-project-dialog";
import { ProjectActions } from "./project-actions";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsSettingsPage() {
  const projects = await listProjects();
  const appUrl = env().APP_URL;

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project has its own API key. Builds report with it from a Dockerfile stage."
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
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.apiKeyPrefix}…</TableCell>
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
    </>
  );
}
