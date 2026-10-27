// SPDX-License-Identifier: FSL-1.1-ALv2
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import type { Severity } from "@/lib/pb/types";
import { runtimeLabel } from "@/lib/runtimes/labels";
import type { Cause, ProjectRef } from "@/lib/triage";
import { cn } from "@/lib/utils";

const SHOWN = 5;

const DOT: Record<Severity, string> = {
  critical: "bg-danger",
  high: "bg-danger",
  moderate: "bg-warn",
  low: "border border-muted-foreground/60",
  unknown: "border border-muted-foreground/60",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What the cause is, in one line: the thing, and what to move it to. */
function what(c: Cause): React.ReactNode {
  switch (c.kind) {
    case "package":
      return (
        <>
          <span className="font-mono">{c.package}</span>{" "}
          <span className="font-mono text-muted-foreground">{c.versions.join(", ")}</span>
          {c.fixedIn && (
            <>
              {" "}
              <span className="text-muted-foreground">→</span> <span className="font-mono">{c.fixedIn}</span>
            </>
          )}
        </>
      );
    case "runtime_security":
      return (
        <>
          {runtimeLabel(c.runtime)} <span className="font-mono text-muted-foreground">{c.running}</span>{" "}
          <span className="text-muted-foreground">→</span> <span className="font-mono">{c.target}</span>
        </>
      );
    case "runtime_eol":
      return (
        <>
          {runtimeLabel(c.runtime)} <span className="font-mono">{c.line}</span>{" "}
          <span className="text-muted-foreground">
            {c.phase === "eol" ? "is past end of life" : `reaches end of life on ${c.end}`}
          </span>
        </>
      );
    case "stale":
      return "No recent build";
  }
}

function why(c: Cause, staleDays: number): string {
  switch (c.kind) {
    case "package":
      return `${c.severity} · ${c.advisories === 1 ? "1 advisory" : `${c.advisories} advisories`}`;
    case "runtime_security":
      return "security release";
    case "runtime_eol":
      return c.phase === "eol" ? "end of life" : "end of life soon";
    case "stale":
      return `nothing reported for ${staleDays}+ days`;
  }
}

function Projects({ projects }: { projects: ProjectRef[] }) {
  const shown = projects.slice(0, 3);
  return (
    <span className="text-muted-foreground">
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
    </span>
  );
}

function Row({ cause, staleDays }: { cause: Cause; staleDays: number }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <span className={cn("size-2 -translate-y-px rounded-full", DOT[cause.severity])} aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm">{what(cause)}</p>
        <p className="text-xs">
          <span
            className={cn(
              cause.severity === "critical" || cause.severity === "high"
                ? "text-danger"
                : "text-muted-foreground",
            )}
          >
            {why(cause, staleDays)}
          </span>
          <span className="text-muted-foreground"> · {plural(cause.projects.length, "project")}: </span>
          <Projects projects={cause.projects} />
        </p>
      </div>
      {cause.href && (
        <Link
          href={cause.href}
          className="col-start-2 inline-flex items-center gap-1 justify-self-start text-xs font-medium text-primary underline-offset-4 hover:underline sm:col-start-3 sm:justify-self-end"
        >
          {cause.kind === "package" ? "Where and how" : "Open"} <ArrowRightIcon className="size-3" />
        </Link>
      )}
    </li>
  );
}

/** The causes that need doing, heaviest first; beyond five they fold away. */
export function AttentionList({ causes, staleDays }: { causes: Cause[]; staleDays: number }) {
  if (causes.length === 0)
    return <p className="text-sm text-muted-foreground">All runtimes patched, no open advisories.</p>;
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
          <summary className="cursor-pointer py-2 text-xs text-muted-foreground select-none hover:text-foreground">
            <span className="group-open:hidden">And {rest.length} more</span>
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
