// SPDX-License-Identifier: FSL-1.1-ALv2
import { ExternalLinkIcon } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { SeverityBadge } from "@/components/status";
import { packageAdvice } from "@/lib/advice";
import type { VulnIssueData } from "@/lib/issues/types";
import type { IssueRecord, LockfileType } from "@/lib/pb/types";

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
  if (issues.length === 0)
    return <div className="rounded-xl border p-6 text-sm text-muted-foreground">{empty}</div>;
  return (
    <ul className="divide-y rounded-xl border">
      {issues.map((issue) => {
        const d = issue.data as unknown as VulnIssueData;
        const cves = d.aliases.filter((a) => a.startsWith("CVE-"));
        const advice = packageAdvice(d, lockfile);
        return (
          <li key={issue.id} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={issue.severity} />
              <span className="font-mono text-sm font-medium">
                {d.package}
                <span className="text-muted-foreground">@{d.version}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {d.direct ? "direct" : d.via.length ? `via ${d.via.join(", ")}` : "transitive"}
                {d.dev && " · dev"}
              </span>
              {issue.status === "ignored" && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">ignored</span>
              )}
            </div>
            <p className="text-sm">{d.summary || "No summary available."}</p>
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
            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none hover:text-foreground">
                How to fix
              </summary>
              <div className="mt-2 space-y-2">
                <p className="text-sm text-muted-foreground">{advice.text}</p>
                {advice.snippets.map((snippet) => (
                  <CodeBlock key={snippet.label} code={snippet.code} label={snippet.label} />
                ))}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
