// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { BadgeRow } from "@/components/badge-row";
import { PageHeader } from "@/components/page-header";
import { appBoard } from "@/lib/app-board";
import { appBadge, appBadgeToken, projectBadge } from "@/lib/badges";
import { getOverview } from "@/lib/data/views";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Badges" };

export default async function BadgesSettingsPage() {
  await requireUser();
  const [items, settings] = await Promise.all([getOverview(), getSettings()]);
  const appUrl = env().APP_URL;
  const apps = appBoard(items, settings.staleDays).sort((a, b) => a.name.localeCompare(b.name));
  const tokens = await Promise.all(apps.map((a) => appBadgeToken(a.id)));

  return (
    <section>
      <PageHeader
        title="Badges"
        description="Status badges for a README. They are public: anyone with the link sees the status, and nothing else. A new token retires the old link."
      />
      {apps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        <ul className="divide-y border-y">
          {apps.map((app, i) => {
            const servers = app.services.flatMap((s) => s.servers);
            return (
              <li key={app.key} className="space-y-3 py-5">
                <div className="space-y-2">
                  <h3 className="font-display text-lg font-bold tracking-tight">{app.name}</h3>
                  <BadgeRow
                    name={app.name}
                    links={appBadge(appUrl, app.id, tokens[i])}
                    target={{ kind: "app", id: app.id }}
                  />
                </div>
                <details className="group text-sm">
                  <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
                    Per project ({servers.length})
                  </summary>
                  <ul className="mt-2 space-y-3 border-l pl-4">
                    {servers.map(({ project }) => (
                      <li key={project.id} className="space-y-1">
                        <Link href={`/projects/${project.slug}`} className="hover:underline">
                          {project.name}
                        </Link>
                        <BadgeRow
                          name={project.name}
                          links={projectBadge(appUrl, project)}
                          target={{ kind: "project", id: project.id }}
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
