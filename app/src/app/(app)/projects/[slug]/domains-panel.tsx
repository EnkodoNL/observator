// SPDX-License-Identifier: FSL-1.1-ALv2
import Link from "next/link";
import { Certificate, Registration } from "@/components/domain-status";
import type { WatchedDomain } from "@/lib/domains/data";
import { registrationPhase, type Limits } from "@/lib/domains/phase";

/** The project's hosts: their certificates and the registrations above them. */
export function DomainsPanel({
  slug,
  domains,
  limits,
  coolifyError,
}: {
  slug: string;
  domains: WatchedDomain[];
  limits: Limits;
  /** Why the domains could not be read from Coolify, the last time. */
  coolifyError?: string | null;
}) {
  const now = new Date();
  return (
    <section className="space-y-2" aria-labelledby="domains">
      <h2 id="domains" className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-display text-xl font-bold tracking-tight">Domains</span>
        <Link
          href={`/domains?project=${encodeURIComponent(slug)}`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {domains.length ? "Manage" : "Add one"}
        </Link>
      </h2>
      {coolifyError && <p className="text-sm text-warn">Domains from Coolify: {coolifyError}.</p>}
      {domains.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No domains watched for this project. Add the names it is served on to hear before a certificate or
          registration runs out.
        </p>
      ) : (
        <ul className="divide-y border-y text-sm">
          {domains.map(({ domain, hosts }) => (
            <li key={domain.id} className="space-y-0.5 py-2">
              {hosts.map((h) => (
                <p key={h.id}>
                  <span className="font-mono text-xs">{h.name}</span> <Certificate host={h} now={now} />
                </p>
              ))}
              <p>
                <span className="font-mono text-xs text-muted-foreground">{domain.name}</span>{" "}
                <Registration domain={domain} phase={registrationPhase(domain, limits, now)} now={now} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
