// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, ShieldAlertIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { nodeOverview } from "@/lib/data/node-overview";
import { pinnedImage } from "@/lib/node/advice";
import { PHASE_LABEL } from "@/lib/node/evaluate";
import { formatDate, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Node versions" };

export default async function NodePage() {
  const { groups: sorted, affected, targets } = await nodeOverview();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Node versions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {sorted.length === 0
            ? "No builds have reported yet."
            : affected > 0
              ? `${affected} project${affected === 1 ? "" : "s"} should move to ${targets.join(" or ")}.`
              : "Every project runs the latest patch of its release line, or one without missing security fixes."}
        </p>
      </div>

      <div className="space-y-4">
        {sorted.map((g) => {
          const ev = g.evaluation;
          const security = ev?.securityUpdate;
          const eol = ev && (ev.phase === "eol" || ev.eolSoon);
          return (
            <section
              key={g.version}
              className={cn(
                "rounded-xl border",
                security && "border-warn/40",
                eol && !security && "border-danger/30",
              )}
            >
              <header className="flex flex-wrap items-start justify-between gap-4 border-b p-4">
                <div>
                  <p className="font-mono text-2xl tracking-tight">{g.version}</p>
                  {ev && ev.phase !== "unknown" && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Node {ev.major}
                      {ev.codename ? ` · ${ev.codename}` : ""} · {PHASE_LABEL[ev.phase]}
                      {ev.end &&
                        (ev.phase === "eol"
                          ? ` since ${formatDate(new Date(ev.end))}`
                          : ` until ${formatDate(new Date(ev.end))}`)}
                    </p>
                  )}
                </div>
                <div className="space-y-2 text-right">
                  {security ? (
                    <p className="flex items-center justify-end gap-1.5 font-medium text-warn">
                      <ShieldAlertIcon className="size-4" />
                      Security update available
                      <ArrowRightIcon className="size-3.5" />
                      <span className="font-mono">{security.target}</span>
                    </p>
                  ) : ev?.patchAvailable ? (
                    <p className="text-sm text-muted-foreground">
                      Newer patch: <span className="font-mono">{ev.latestInLine}</span>
                    </p>
                  ) : (
                    <p className="flex items-center justify-end gap-1.5 text-sm text-ok">
                      <ShieldCheckIcon className="size-4" /> Up to date
                    </p>
                  )}
                  {eol && (
                    <p className="flex items-center justify-end gap-1.5 text-sm text-danger">
                      <TriangleAlertIcon className="size-4" />
                      {ev!.phase === "eol" ? "End-of-life" : `End-of-life in ${ev!.daysToEol} days`}
                    </p>
                  )}
                </div>
              </header>
              <ul className="divide-y">
                {g.projects.map(({ project, latest, lastBuildAt }) => (
                  <li
                    key={project.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5"
                  >
                    <Link href={`/projects/${project.slug}`} className="font-medium hover:underline">
                      {project.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {[latest?.os, latest?.platform && `${latest.platform}/${latest.arch}`]
                        .filter(Boolean)
                        .join(" · ")}{" "}
                      · last build {timeAgo(lastBuildAt)}
                    </span>
                  </li>
                ))}
              </ul>
              {security && (
                <div className="border-t bg-muted/30 p-4">
                  <p className="mb-2 text-sm text-muted-foreground">
                    Pin the patched image in these Dockerfiles and redeploy:
                  </p>
                  <CodeBlock
                    code={[
                      ...new Set(g.projects.map((p) => pinnedImage(security.target, p.latest?.os ?? ""))),
                    ]
                      .map((tag) => `FROM ${tag} AS app`)
                      .join("\n")}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
