// SPDX-License-Identifier: FSL-1.1-ALv2
import { ArrowSquareOutIcon, CaretRightIcon } from "@phosphor-icons/react/ssr";
import { CodeBlock } from "@/components/code-block";
import { SeverityBadge } from "@/components/status";
import { packageAdvice } from "@/lib/advice";
import type { VulnIssueData } from "@/lib/issues/types";
import type { IssueRecord, LockfileType } from "@/lib/pb/types";
import { cn } from "@/lib/utils";
import { groupVulns, type VulnGroup } from "@/lib/vuln-groups";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** How the package got in, from any of its advisories: they share the dependency path. */
function origin(d: VulnIssueData): string {
  return d.direct ? "direct" : d.via.length ? `via ${d.via.join(", ")}` : "transitive";
}

/** Severity | package | installed | fixed in | advisories | how it got in; three columns on a phone. */
const GRID =
  "grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-baseline gap-x-4 md:grid-cols-[6rem_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_5.5rem_minmax(0,1.3fr)]";

function Fix({ group, lockfile }: { group: VulnGroup; lockfile: LockfileType }) {
  if (group.open === 0) return null;
  const advice = group.fix
    ? packageAdvice(group.fix, lockfile)
    : packageAdvice({ ...(group.issues[0].data as unknown as VulnIssueData), fixedIn: "" }, lockfile);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {group.open > 1 && <b className="text-foreground">Fix all {group.open}. </b>}
        {advice.text}
        {group.fix && group.unfixed > 0 && (
          <> {plural(group.unfixed, "advisory has", "advisories have")} no fixed version yet, so stay open.</>
        )}
      </p>
      {advice.snippets.map((snippet) => (
        <CodeBlock key={snippet.label} code={snippet.code} label={snippet.label} />
      ))}
    </div>
  );
}

function Group({
  group,
  lockfile,
  quiet,
  actions,
}: {
  group: VulnGroup;
  lockfile: LockfileType;
  quiet?: boolean;
  actions?: (issue: IssueRecord) => React.ReactNode;
}) {
  const first = group.issues[0].data as unknown as VulnIssueData;
  const done = group.open === 0;
  return (
    <li className="border-b">
      <details className="group">
        <summary
          className={cn(
            GRID,
            "-mx-2 cursor-pointer list-none rounded-sm px-2 py-3 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring [&::-webkit-details-marker]:hidden",
            done && "text-muted-foreground",
          )}
        >
          <SeverityBadge severity={group.severity} quiet={quiet || done} />
          <span className="flex min-w-0 items-baseline gap-2">
            <CaretRightIcon className="size-3 shrink-0 self-center text-muted-foreground transition-transform group-open:rotate-90" />
            <b className="truncate">{group.package}</b>
            <span className="truncate font-mono text-xs text-muted-foreground md:hidden">
              {group.versions.join(", ")}
              {group.fix && ` to ${group.fix.fixedIn}`}
            </span>
          </span>
          <span className="hidden truncate font-mono text-xs md:block">{group.versions.join(", ")}</span>
          <span className="hidden truncate font-mono text-xs md:block">
            {group.fix ? group.fix.fixedIn : <span className="text-muted-foreground">none yet</span>}
          </span>
          <span className="text-right tabular-nums md:text-left">
            {group.open}
            {group.open < group.issues.length && (
              <span className="text-muted-foreground"> +{group.issues.length - group.open} ignored</span>
            )}
          </span>
          <span className="hidden truncate text-muted-foreground md:block">{origin(first)}</span>
        </summary>

        <div className="mb-4 space-y-4 rounded-md bg-muted px-4 py-3 md:ml-[7rem]">
          <ul className="space-y-3">
            {group.issues.map((issue) => {
              const d = issue.data as unknown as VulnIssueData;
              const ignored = issue.status === "ignored";
              return (
                <li
                  key={issue.id}
                  className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]"
                >
                  <SeverityBadge severity={issue.severity} quiet={quiet || ignored} />
                  <span className={cn(ignored && "text-muted-foreground")}>
                    {d.summary || "No summary available."}
                    {!d.fixedIn && <span className="text-muted-foreground"> No fixed version yet.</span>}
                  </span>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="col-start-2 inline-flex items-center gap-1 justify-self-start font-mono text-xs text-primary hover:underline sm:col-start-3"
                  >
                    {d.osvId} <ArrowSquareOutIcon className="size-3" />
                  </a>
                  {actions && (
                    <span className="col-start-2 text-xs text-muted-foreground">{actions(issue)}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <Fix group={group} lockfile={lockfile} />
        </div>
      </details>
    </li>
  );
}

/** A project's advisories, one row per package; a row opens to its advisories and the fix. */
export function VulnList({
  issues,
  empty,
  lockfile,
  quiet,
  actions,
}: {
  issues: IssueRecord[];
  empty: React.ReactNode;
  lockfile: LockfileType;
  /** For advisories that do not count: severities in grey. */
  quiet?: boolean;
  actions?: (issue: IssueRecord) => React.ReactNode;
}) {
  if (issues.length === 0) return <p className="border-y py-4 text-muted-foreground">{empty}</p>;
  return (
    <div>
      <div
        className={cn(GRID, "hidden border-b pb-2 text-sm text-muted-foreground md:grid")}
        aria-hidden="true"
      >
        <span>Severity</span>
        <span>Package</span>
        <span>Installed</span>
        <span>Fixed in</span>
        <span>Advisories</span>
        <span>How it got in</span>
      </div>
      <ul className="border-t md:border-t-0">
        {groupVulns(issues).map((group) => (
          <Group key={group.key} group={group} lockfile={lockfile} quiet={quiet} actions={actions} />
        ))}
      </ul>
    </div>
  );
}
