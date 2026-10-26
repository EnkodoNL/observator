// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, ShieldAlertIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { runtimeOverview, type RuntimeSection, type VersionGroup } from "@/lib/data/runtime-overview";
import { lineDescription, pinFor } from "@/lib/runtimes/labels";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Runtimes" };

function VersionCard({ section, group }: { section: RuntimeSection; group: VersionGroup }) {
  const ev = group.evaluation;
  const security = ev?.securityUpdate;
  const eol = ev && (ev.phase === "eol" || ev.eolSoon);
  const line = lineDescription(ev);
  const pins = security
    ? [
        ...new Set(group.projects.map((p) => pinFor(section.runtime, security.target, p.latest?.os ?? ""))),
      ].filter((p): p is string => Boolean(p))
    : [];
  return (
    <section
      className={cn(
        "rounded-xl border",
        security && "border-warn/40",
        eol && !security && "border-danger/30",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b p-4">
        <div>
          <p className="font-mono text-2xl tracking-tight">{group.version}</p>
          {line && <p className="mt-1 text-sm text-muted-foreground">{line}</p>}
        </div>
        <div className="space-y-2 text-right">
          {!section.checked ? (
            <p className="text-sm text-muted-foreground">Not checked yet</p>
          ) : !ev ? (
            <p className="text-sm text-muted-foreground">No release data right now</p>
          ) : security ? (
            <p className="flex items-center justify-end gap-1.5 font-medium text-warn">
              <ShieldAlertIcon className="size-4" />
              Security update available
              <ArrowRightIcon className="size-3.5" />
              <span className="font-mono">{security.target}</span>
            </p>
          ) : ev.patchAvailable ? (
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
        {group.projects.map(({ project, latest, lastBuildAt }) => (
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
      {pins.length > 0 && (
        <div className="border-t bg-muted/30 p-4">
          <p className="mb-2 text-sm text-muted-foreground">
            Pin the patched image in these Dockerfiles and redeploy:
          </p>
          <CodeBlock code={pins.map((tag) => `FROM ${tag} AS app`).join("\n")} />
        </div>
      )}
    </section>
  );
}

export default async function RuntimesPage() {
  const sections = await runtimeOverview();
  const affected = sections.reduce((n, s) => n + s.affected, 0);
  const targets = sections.flatMap((s) => s.targets.map((t) => `${s.label} ${t}`));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Runtimes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {sections.length === 0
            ? "No builds have reported yet."
            : affected > 0
              ? `${affected} project${affected === 1 ? "" : "s"} should move to ${targets.join(" or ")}.`
              : "Every checked runtime is on the latest patch of its release line, or one without missing security fixes."}
        </p>
      </div>

      {sections.map((section) => (
        <section key={section.runtime} className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-lg font-semibold tracking-tight">{section.label}</h2>
            <span className="text-sm text-muted-foreground">
              {section.checked
                ? "release line, security releases and end-of-life checked"
                : "shown as reported; release checks come later"}
            </span>
          </div>
          {section.versions.map((g) => (
            <VersionCard key={g.version} section={section} group={g} />
          ))}
        </section>
      ))}
    </div>
  );
}
