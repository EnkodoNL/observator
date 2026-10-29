// SPDX-License-Identifier: FSL-1.1-ALv2
import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/ssr";
import { SEVERITY_TEXT } from "@/components/status";
import { runtimeLabel } from "@/lib/runtimes/labels";
import { domainDetail } from "@/lib/domains/phase";
import { SEVERITY_LABEL } from "@/lib/severity";
import type { Cause, ProjectRef } from "@/lib/triage";
import { cn } from "@/lib/utils";

const SHOWN = 5;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The first column: how bad, or what kind of chore. */
function kind(c: Cause): string {
  switch (c.kind) {
    case "package":
      return SEVERITY_LABEL[c.severity];
    case "runtime_security":
      return "Security";
    case "runtime_eol":
      return c.phase === "eol" ? "End of life" : "EOL soon";
    case "domain":
      return c.phase === "remind" ? "Reminder" : c.target === "certificate" ? "Certificate" : "Domain";
    case "stale":
      return "Stale";
  }
}

/** The thing, and what to move it to. */
function what(c: Cause): React.ReactNode {
  const to = (from: string, target: string | null) => (
    <span className="ml-2 font-mono text-xs text-muted-foreground">
      {from}
      {target && ` to ${target}`}
    </span>
  );
  switch (c.kind) {
    case "package":
      return (
        <>
          <b>{c.package}</b>
          {to(c.versions.join(", "), c.fixedIn)}
        </>
      );
    case "runtime_security":
      return (
        <>
          <b>{runtimeLabel(c.runtime)}</b>
          {to(c.running, c.target)}
        </>
      );
    case "runtime_eol":
      return (
        <>
          <b>
            {runtimeLabel(c.runtime)} {c.line}
          </b>
          <span className="ml-2 text-muted-foreground">
            {c.phase === "eol" ? "is past end of life" : `reaches end of life on ${c.end}`}
          </span>
        </>
      );
    case "domain":
      return (
        <>
          <b>{c.name}</b>
          <span className="ml-2 text-muted-foreground">{domainDetail(c)}</span>
        </>
      );
    case "stale":
      return <b>No recent build</b>;
  }
}

function why(c: Cause, staleDays: number): string | null {
  switch (c.kind) {
    case "package":
      return plural(c.advisories, "advisory", "advisories");
    case "runtime_security":
      return "a security release";
    case "stale":
      return `nothing reported for ${staleDays}+ days`;
    default:
      return null;
  }
}

function Projects({ projects }: { projects: ProjectRef[] }) {
  const shown = projects.slice(0, 3);
  return (
    <>
      {shown.map((p, i) => (
        <span key={p.slug}>
          {i > 0 && ", "}
          <Link
            href={`/projects/${p.slug}`}
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            {p.name}
          </Link>
        </span>
      ))}
      {projects.length > shown.length && ` and ${projects.length - shown.length} more`}
    </>
  );
}

function Row({ cause, staleDays }: { cause: Cause; staleDays: number }) {
  const reason = why(cause, staleDays);
  return (
    <li className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-0.5 py-3 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto]">
      <span
        className={cn(
          "text-sm font-bold",
          cause.kind === "package" || cause.kind === "runtime_security" || cause.kind === "domain"
            ? SEVERITY_TEXT[cause.severity]
            : "text-warn",
        )}
      >
        {kind(cause)}
      </span>
      <span className="min-w-0">{what(cause)}</span>
      {cause.href && (
        <Link
          href={cause.href}
          className="col-start-2 inline-flex items-center gap-1 justify-self-start text-sm font-bold text-primary underline-offset-4 hover:underline sm:col-start-3 sm:row-start-1 sm:justify-self-end"
        >
          {cause.kind === "package" && cause.projects.length > 1 ? "Where and how" : "Open"}
          <ArrowRightIcon className="size-3.5" />
        </Link>
      )}
      <span className="col-start-2 text-sm text-muted-foreground">
        {cause.kind === "domain" ? (
          <>
            {cause.note}
            {cause.note && cause.projects.length > 0 && " · "}
            <Projects projects={cause.projects} />
          </>
        ) : (
          <>
            {reason && `${reason} in `}
            <Projects projects={cause.projects} />
          </>
        )}
      </span>
    </li>
  );
}

/** What needs doing, heaviest first; beyond five it folds away. */
export function AttentionList({ causes, staleDays }: { causes: Cause[]; staleDays: number }) {
  if (causes.length === 0)
    return (
      <p className="border-y py-4 text-muted-foreground">
        Nothing to do. Runtimes are patched and no package in production has an open advisory.
      </p>
    );
  const rest = causes.slice(SHOWN);
  return (
    <div>
      <ul className="divide-y border-y">
        {causes.slice(0, SHOWN).map((c) => (
          <Row key={c.key} cause={c} staleDays={staleDays} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer py-2 text-sm text-muted-foreground select-none hover:text-foreground">
            <span className="group-open:hidden">{plural(rest.length, "more thing")}</span>
            <span className="hidden group-open:inline">Fewer</span>
          </summary>
          <ul className="divide-y border-b">
            {rest.map((c) => (
              <Row key={c.key} cause={c} staleDays={staleDays} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
