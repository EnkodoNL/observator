// SPDX-License-Identifier: FSL-1.1-ALv2
import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/pb/types";
import { STATUS_LABEL, type ProjectStatus } from "@/lib/status";
import { SEVERITY_LABEL } from "@/lib/severity";

const STATUS: Record<ProjectStatus, { className: string; dot: string }> = {
  none: { className: "text-muted-foreground bg-muted", dot: "bg-muted-foreground/50" },
  ok: { className: "text-ok bg-ok/10", dot: "bg-ok" },
  update: { className: "text-warn bg-warn/12", dot: "bg-warn" },
  vulnerable: { className: "text-danger bg-danger/10", dot: "bg-danger" },
};

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        s.className,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

const SEVERITY_CLASS: Record<Severity, string> = {
  critical: "bg-danger text-white dark:text-black",
  high: "bg-danger/12 text-danger",
  moderate: "bg-warn/15 text-warn",
  low: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold tracking-wide uppercase",
        SEVERITY_CLASS[severity],
        className,
      )}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}
