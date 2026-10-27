// SPDX-License-Identifier: FSL-1.1-ALv2
import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/pb/types";
import { STATUS_LABEL, type ProjectStatus } from "@/lib/status";
import { SEVERITY_LABEL } from "@/lib/severity";

// The colour sits in the dot; only warn and danger also colour the text.
const STATUS: Record<ProjectStatus, { className: string; dot: string }> = {
  none: { className: "text-muted-foreground", dot: "border border-muted-foreground/60" },
  ok: { className: "text-foreground", dot: "bg-ok" },
  update: { className: "text-warn", dot: "bg-warn" },
  vulnerable: { className: "text-danger", dot: "bg-danger" },
};

/** dot: only the dot, with the status as its accessible name, for rows that are dense already. */
export function StatusBadge({
  status,
  dot,
  className,
}: {
  status: ProjectStatus;
  dot?: boolean;
  className?: string;
}) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap",
        !dot && "h-6",
        s.className,
        className,
      )}
      title={dot ? STATUS_LABEL[status] : undefined}
    >
      <span className={cn("size-2 shrink-0 rounded-full", s.dot)} aria-hidden="true" />
      <span className={cn(dot && "sr-only")}>{STATUS_LABEL[status]}</span>
    </span>
  );
}

/** Only critical is filled; the rest is a hairline in its tone, so a row of them stays quiet. */
const SEVERITY_CLASS: Record<Severity, string> = {
  critical: "border-danger bg-danger text-primary-foreground dark:text-background",
  high: "border-danger/50 text-danger",
  moderate: "border-warn/50 text-warn",
  low: "border-border text-muted-foreground",
  unknown: "border-border text-muted-foreground",
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm border px-1.5 font-mono text-[11px] font-medium tracking-wide uppercase",
        SEVERITY_CLASS[severity],
        className,
      )}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}
