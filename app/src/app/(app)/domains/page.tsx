// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listDomains } from "@/lib/domains/data";
import { domainAttention, registrationPhase } from "@/lib/domains/phase";
import { listProjects } from "@/lib/data/projects";
import { getSettings } from "@/lib/settings";
import { Certificate, Registration } from "@/components/domain-status";
import { AddDomainForm, DomainActions, HostActions } from "./domain-controls";

export const metadata: Metadata = { title: "Domains" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function DomainsPage({ searchParams }: PageProps<"/domains">) {
  const { readOnly } = await requireUser();
  const params = await searchParams;
  const [watched, projects, settings] = await Promise.all([listDomains(), listProjects(), getSettings()]);
  const now = new Date();
  const limits = { warnDays: settings.domainWarnDays, urgentDays: settings.domainUrgentDays };
  const projectBySlug = new Map(projects.map((p) => [p.slug, p]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const only = typeof params.project === "string" ? projectBySlug.get(params.project) : undefined;
  const shown = only ? watched.filter((w) => w.hosts.some((h) => h.project === only.id)) : watched;
  const attention = domainAttention(shown, limits, now);
  const options = projects.map((p) => ({ id: p.id, name: p.name }));
  const hostCount = shown.reduce((n, w) => n + w.hosts.length, 0);

  return (
    <div className="space-y-10">
      <div className="max-w-[65ch] space-y-3">
        <h1 className="font-display text-4xl leading-none font-bold tracking-tight">Domains</h1>
        <p className="text-muted-foreground">
          {shown.length === 0 ? (
            "Nothing watched yet. Add a domain to hear before its registration or certificate runs out."
          ) : (
            <>
              <b className="text-foreground">{plural(shown.length, "domain")}</b> and{" "}
              {plural(hostCount, "certificate")} watched
              {only && <> for {only.name}</>}.{" "}
              {attention.length
                ? `${plural(attention.length, "thing")} ${attention.length === 1 ? "needs" : "need"} attention.`
                : "Nothing runs out soon."}{" "}
              Registrations warn {settings.domainWarnDays} days ahead; certificates once a third of their life
              is left, the point where they should have renewed.
            </>
          )}
        </p>
        {only && (
          <Link href="/domains" className="text-sm font-bold text-primary underline-offset-4 hover:underline">
            Show all domains
          </Link>
        )}
      </div>

      {!readOnly && <AddDomainForm projects={options} project={only?.id} />}

      {shown.length > 0 && (
        <ul className="divide-y border-y">
          {shown.map(({ domain, hosts }) => {
            const phase = registrationPhase(domain, limits, now);
            return (
              <li key={domain.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0 space-y-0.5">
                    <h2 className="font-display text-lg font-bold tracking-tight">{domain.name}</h2>
                    <p className="text-sm">
                      <Registration domain={domain} phase={phase} now={now} />
                    </p>
                    {(domain.note || domain.remindDays > 0) && (
                      <p className="text-sm text-muted-foreground">
                        {domain.remindDays > 0 && `Reminder ${plural(domain.remindDays, "day")} ahead. `}
                        {domain.note}
                      </p>
                    )}
                  </div>
                  {!readOnly && (
                    <DomainActions
                      domain={{
                        id: domain.id,
                        name: domain.name,
                        note: domain.note,
                        remindDays: domain.remindDays,
                        manualExpiresAt: domain.manualExpiresAt,
                      }}
                    />
                  )}
                </div>
                {hosts.length > 0 && (
                  <ul className="ml-1 space-y-1 border-l pl-4 text-sm">
                    {hosts.map((host) => {
                      const project = projectById.get(host.project);
                      return (
                        <li
                          key={host.id}
                          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
                        >
                          <span className="min-w-0">
                            <span className="font-mono text-xs">{host.name}</span>{" "}
                            <Certificate host={host} now={now} />
                            {(host.sources ?? []).filter((s) => s !== "manual").length > 0 && (
                              <span className="text-muted-foreground">
                                {" "}
                                · from {(host.sources ?? []).filter((s) => s !== "manual").join(" and ")}
                              </span>
                            )}
                            {readOnly && project && (
                              <span className="text-muted-foreground">
                                {" "}
                                ·{" "}
                                <Link href={`/projects/${project.slug}`} className="hover:underline">
                                  {project.name}
                                </Link>
                              </span>
                            )}
                          </span>
                          {!readOnly && (
                            <HostActions
                              host={{ id: host.id, name: host.name, project: host.project }}
                              projects={options}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
