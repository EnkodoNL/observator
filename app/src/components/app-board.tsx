// SPDX-License-Identifier: FSL-1.1-ALv2
import Link from "next/link";
import { CaretRightIcon } from "@phosphor-icons/react/ssr";
import { SEVERITY_TEXT } from "@/components/status";
import type { App, Service } from "@/lib/app-board";
import type { ProjectSummary } from "@/lib/data/views";
import type { Severity } from "@/lib/pb/types";
import { primaryRuntime } from "@/lib/runtimes/labels";
import { countsText, worstCounted } from "@/lib/severity";
import { cn } from "@/lib/utils";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2 high, 10 moderate" in the colour of the worst; otherwise build-only or clean. */
function Advisories({
  counts,
  buildOnly,
  built,
  stale,
}: {
  counts: Partial<Record<Severity, number>>;
  buildOnly: number;
  built: boolean;
  stale: boolean;
}) {
  if (!built) return <span className="text-muted-foreground">no build yet</span>;
  const worst = worstCounted(counts);
  const text = worst ? countsText(counts) : buildOnly ? `${buildOnly} build-only` : "clean";
  return (
    <span
      className={cn(
        worst ? SEVERITY_TEXT[worst] : buildOnly ? "text-quiet" : "text-muted-foreground",
        worst && "font-bold",
      )}
    >
      {text}
      {stale && <span className="font-normal text-warn">, stale</span>}
    </span>
  );
}

function Runtime({ item }: { item: ProjectSummary }) {
  const lead = primaryRuntime(item.latest?.runtimes);
  if (!item.latest) return null;
  if (!lead) return <span className="text-muted-foreground">no runtime</span>;
  return (
    <span
      className={cn(
        "font-mono text-xs",
        item.summary.runtimeSecurity.length ? "text-warn" : "text-muted-foreground",
      )}
    >
      {lead.name} {lead.version}
    </span>
  );
}

const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 py-2 text-sm";
/** With a runtime column, where the row is wide enough. */
const WIDE = "sm:grid-cols-[minmax(0,1fr)_9rem_minmax(8rem,auto)]";
const ROW_LINK =
  "-mx-2 rounded-sm px-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring";

function ServiceRows({ service, compact }: { service: Service; compact?: boolean }) {
  const [first] = service.servers;
  const row = cn(ROW, !compact && WIDE);
  const runtimeCell = compact ? "hidden" : "hidden sm:block";
  if (service.servers.length === 1) {
    return (
      <li className="border-t first:border-t-0">
        <Link href={`/projects/${first.project.slug}`} className={cn(row, ROW_LINK)}>
          <span className="truncate">{service.name}</span>
          <span className={runtimeCell}>
            <Runtime item={first} />
          </span>
          <span className="text-right">
            <Advisories
              counts={service.counts}
              buildOnly={service.buildOnly}
              built={Boolean(first.latest)}
              stale={service.stale}
            />
          </span>
        </Link>
      </li>
    );
  }
  return (
    <li className="border-t first:border-t-0">
      <div className={row}>
        <span className="truncate">
          {service.name} <span className="text-muted-foreground">on {service.servers.length} servers</span>
        </span>
        <span className={runtimeCell} />
        <span className="text-right">
          <Advisories counts={service.counts} buildOnly={service.buildOnly} built stale={service.stale} />
        </span>
      </div>
      <ul className="mb-2 ml-1 border-l pl-3">
        {service.servers.map((s) => (
          <li key={s.project.id}>
            <Link href={`/projects/${s.project.slug}`} className={cn(row, ROW_LINK, "py-1")}>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {s.project.instance || s.project.name}
              </span>
              <span className={runtimeCell}>
                <Runtime item={s} />
              </span>
              <span className="text-right text-xs">
                <Advisories
                  counts={s.summary.vulnBySeverity}
                  buildOnly={s.summary.buildOnly.length}
                  built={Boolean(s.latest)}
                  stale={false}
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** What the app as a whole needs, in a few words. */
function headline(app: App): { text: string; className: string } {
  if (app.advisories)
    return {
      text: `${app.advisories} in production`,
      className: SEVERITY_TEXT[app.worstSeverity ?? "unknown"],
    };
  if (app.status === "update") return { text: "Runtime update", className: "text-warn" };
  if (app.stale) return { text: "Stale", className: "text-warn" };
  return { text: "", className: "" };
}

function Panel({ app }: { app: App }) {
  const h = headline(app);
  return (
    <article className="min-w-0 rounded-md border bg-card px-4 pt-3 pb-2 sm:px-5">
      <header className="flex items-baseline justify-between gap-3 pb-1">
        <h3 className="truncate font-display text-xl font-bold tracking-tight">{app.name}</h3>
        <span className={cn("shrink-0 text-sm font-bold", h.className)}>{h.text}</span>
      </header>
      <ul>
        {app.services.map((s) => (
          <ServiceRows key={s.key} service={s} />
        ))}
      </ul>
    </article>
  );
}

function inOrderSummary(app: App): string {
  const servers = app.services.reduce((n, s) => n + s.servers.length, 0);
  const parts = [
    plural(app.services.length, "service") + (servers > app.services.length ? ` on ${servers} servers` : ""),
  ];
  if (app.status === "none") parts.push("waiting for a first build");
  if (app.buildOnly) parts.push(`${app.buildOnly} build-only`);
  return parts.join(", ");
}

/** Apps that need work as panels; the rest as a short index that opens per app. */
export function AppBoard({ apps }: { apps: App[] }) {
  const work = apps.filter((a) => a.needsWork);
  const fine = apps.filter((a) => !a.needsWork);
  return (
    <div className="space-y-12">
      {work.length > 0 && (
        <section aria-labelledby="needs-work" className="space-y-3">
          <h2 id="needs-work" className="font-display text-xl font-bold tracking-tight">
            Needs work
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {work.map((app) => (
              <Panel key={app.key} app={app} />
            ))}
          </div>
        </section>
      )}
      {fine.length > 0 && (
        <section aria-labelledby="in-order" className="space-y-3">
          <h2 id="in-order" className="font-display text-xl font-bold tracking-tight">
            In order
          </h2>
          <ul className="grid gap-x-8 border-t sm:grid-cols-2 lg:grid-cols-3">
            {fine.map((app) => (
              <li key={app.key} className="border-b">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-baseline gap-2 py-2.5 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <CaretRightIcon className="size-3 shrink-0 self-center text-muted-foreground transition-transform group-open:rotate-90" />
                    <b className="truncate font-display">{app.name}</b>
                    <span className="ml-auto truncate pl-2 text-right text-sm text-muted-foreground">
                      {inOrderSummary(app)}
                    </span>
                  </summary>
                  <ul className="pb-2">
                    {app.services.map((s) => (
                      <ServiceRows key={s.key} service={s} compact />
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
