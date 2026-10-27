// SPDX-License-Identifier: FSL-1.1-ALv2
import { ExternalLinkIcon } from "lucide-react";
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
  return `${d.direct ? "direct" : d.via.length ? `via ${d.via.join(", ")}` : "transitive"}${d.dev ? " · dev" : ""}`;
}

function Fix({ group, lockfile }: { group: VulnGroup; lockfile: LockfileType }) {
  if (group.open === 0) return null;
  const advice = group.fix
    ? packageAdvice(group.fix, lockfile)
    : packageAdvice({ ...(group.issues[0].data as unknown as VulnIssueData), fixedIn: "" }, lockfile);
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none hover:text-foreground">
        How to fix {group.open > 1 && `all ${group.open}`}
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-sm text-muted-foreground">
          {advice.text}
          {group.fix && group.unfixed > 0 && (
            <>
              {" "}
              {plural(group.unfixed, "advisory has", "advisories have")} no fixed version yet, so stay open.
            </>
          )}
        </p>
        {advice.snippets.map((snippet) => (
          <CodeBlock key={snippet.label} code={snippet.code} label={snippet.label} />
        ))}
      </div>
    </details>
  );
}

/** A project's advisories, one entry per package: the upgrade once, the advisories below it. */
export function VulnList({
  issues,
  empty,
  lockfile,
  actions,
}: {
  issues: IssueRecord[];
  empty: React.ReactNode;
  lockfile: LockfileType;
  actions?: (issue: IssueRecord) => React.ReactNode;
}) {
  if (issues.length === 0) return <div className="border-y py-6 text-sm text-muted-foreground">{empty}</div>;
  return (
    <ul className="divide-y border-y">
      {groupVulns(issues).map((group) => {
        const first = group.issues[0].data as unknown as VulnIssueData;
        return (
          <li key={group.key} className={cn("space-y-3 py-4", group.open === 0 && "text-muted-foreground")}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <SeverityBadge severity={group.severity} className="self-center" />
              <span className="font-mono text-sm font-medium">
                {group.package}
                <span className="text-muted-foreground">@{group.versions.join(", ")}</span>
              </span>
              {group.fix && (
                <span className="font-mono text-sm">
                  <span className="text-muted-foreground">→ </span>
                  {group.fix.fixedIn}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {origin(first)} · {plural(group.issues.length, "advisory", "advisories")}
                {group.open < group.issues.length && `, ${group.issues.length - group.open} ignored`}
              </span>
            </div>

            <ul className="ml-1 space-y-2 border-l pl-4">
              {group.issues.map((issue) => {
                const d = issue.data as unknown as VulnIssueData;
                const cves = d.aliases?.filter((a) => a.startsWith("CVE-")) ?? [];
                return (
                  <li key={issue.id} className="space-y-1">
                    <p className="text-sm">
                      <span className="mr-2 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                        {issue.severity}
                      </span>
                      {d.summary || "No summary available."}
                      {issue.status === "ignored" && (
                        <span className="ml-2 rounded-sm border px-1.5 py-px text-xs text-muted-foreground">
                          ignored
                        </span>
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {d.osvId} <ExternalLinkIcon className="size-3" />
                      </a>
                      {cves.length > 0 && <span className="font-mono">{cves.join(", ")}</span>}
                      <span>{d.fixedIn ? `Fixed in ${d.fixedIn}` : "No fixed version yet"}</span>
                      {actions && <span className="ml-auto">{actions(issue)}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>

            <Fix group={group} lockfile={lockfile} />
          </li>
        );
      })}
    </ul>
  );
}
