// SPDX-License-Identifier: FSL-1.1-ALv2
import { ArrowDownIcon, ArrowRightIcon, ArrowUpIcon, TriangleAlertIcon } from "lucide-react";
import { changeDirection } from "@/lib/ingest/direction";
import { pbDate } from "@/lib/pb/admin";
import type { BuildRecord } from "@/lib/pb/types";
import { formatDateTime, timeAgo } from "@/lib/time";

function ChangeSummary({ build }: { build: BuildRecord }) {
  const c = build.changes;
  if (!c) return null;
  const ups = c.changed.filter((p) => changeDirection(p.from, p.to) === "up").length;
  const downs = c.changed.filter((p) => changeDirection(p.from, p.to) === "down").length;
  const other = c.changed.length - ups - downs;
  const parts = [
    c.added.length > 0 && (
      <span key="a" className="text-ok" title="added">
        +{c.added.length}
      </span>
    ),
    c.removed.length > 0 && (
      <span key="r" className="text-danger" title="removed">
        −{c.removed.length}
      </span>
    ),
    ups > 0 && (
      <span key="u" title="upgraded">
        ↑{ups}
      </span>
    ),
    downs > 0 && (
      <span key="d" className="text-warn" title="downgraded">
        ↓{downs}
      </span>
    ),
    other > 0 && (
      <span key="o" className="text-muted-foreground" title="changed">
        ~{other}
      </span>
    ),
  ].filter(Boolean);
  if (parts.length === 0) return <span className="text-muted-foreground">no package changes</span>;
  return <span className="flex gap-2 font-mono tabular-nums">{parts}</span>;
}

function Diff({ build }: { build: BuildRecord }) {
  const c = build.changes;
  if (!c || c.added.length + c.removed.length + c.changed.length === 0) return null;
  return (
    <details className="group mt-2">
      <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">
        Show package changes
      </summary>
      <div className="mt-2 grid gap-1 rounded-lg bg-muted/40 p-3 font-mono text-xs">
        {c.changed.map((p) => {
          const dir = changeDirection(p.from, p.to);
          return (
            <div key={`c-${p.name}`} className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex w-4">
                {dir === "up" ? (
                  <ArrowUpIcon className="size-3" aria-label="upgraded" />
                ) : dir === "down" ? (
                  <ArrowDownIcon className="size-3 text-warn" aria-label="downgraded" />
                ) : (
                  <span className="text-muted-foreground">~</span>
                )}
              </span>
              {p.name}
              <span className="text-muted-foreground">{p.from}</span>
              <ArrowRightIcon className="size-3 text-muted-foreground" />
              <span>{p.to}</span>
            </div>
          );
        })}
        {c.added.map((p) => (
          <div key={`a-${p.name}@${p.version}`}>
            <span className="inline-block w-4 text-ok">+</span>
            {p.name} <span className="text-muted-foreground">{p.version}</span>
          </div>
        ))}
        {c.removed.map((p) => (
          <div key={`r-${p.name}@${p.version}`}>
            <span className="inline-block w-4 text-danger">−</span>
            {p.name} <span className="text-muted-foreground">{p.version}</span>
          </div>
        ))}
        {c.truncated && <div className="text-muted-foreground">List truncated.</div>}
      </div>
    </details>
  );
}

export function BuildsList({ builds }: { builds: BuildRecord[] }) {
  if (builds.length === 0) {
    return <p className="text-sm text-muted-foreground">No builds yet.</p>;
  }
  return (
    <ol className="divide-y rounded-xl border">
      {builds.map((b, i) => {
        const date = pbDate(b.created);
        const nodeChange = b.changes?.node;
        const isFirst = i === builds.length - 1;
        return (
          <li key={b.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-sm">
                  {nodeChange ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-muted-foreground">{nodeChange.from}</span>
                      <ArrowRightIcon className="size-3.5 text-muted-foreground" />
                      <span className="font-medium">{nodeChange.to}</span>
                    </span>
                  ) : (
                    b.nodeVersion
                  )}
                </span>
                {nodeChange && (
                  <span className="rounded bg-brand/10 px-1.5 py-0.5 text-xs text-brand">Node changed</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {[b.lockfileType !== "none" && b.lockfileType, `${b.packageCount} packages`, b.os]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                {!isFirst && <ChangeSummary build={b} />}
                <time
                  className="text-muted-foreground"
                  dateTime={date?.toISOString()}
                  title={formatDateTime(date)}
                >
                  {timeAgo(date)}
                </time>
              </div>
            </div>
            {b.error && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" /> {b.error}
              </p>
            )}
            {!isFirst && <Diff build={b} />}
          </li>
        );
      })}
    </ol>
  );
}
