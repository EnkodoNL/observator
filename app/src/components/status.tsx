// SPDX-License-Identifier: FSL-1.1-ALv2
import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/pb/types";
import { STATUS_LABEL, type ProjectStatus } from "@/lib/status";
import { SEVERITY_LABEL } from "@/lib/severity";

// Status and severity are words in their colour; only what needs doing is coloured at all.
const STATUS_CLASS: Record<ProjectStatus, string> = {
  none: "text-muted-foreground",
  ok: "text-ok",
  update: "text-warn",
  vulnerable: "text-danger",
};

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  return (
    <span className={cn("text-sm font-bold whitespace-nowrap", STATUS_CLASS[status], className)}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export const SEVERITY_TEXT: Record<Severity, string> = {
  critical: "text-danger",
  high: "text-danger",
  moderate: "text-warn",
  low: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

/** quiet: an advisory that does not count (build-only, ignored), so never alarming. */
export function SeverityBadge({
  severity,
  quiet,
  className,
}: {
  severity: Severity;
  quiet?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-bold whitespace-nowrap",
        quiet ? "text-quiet" : SEVERITY_TEXT[severity],
        severity === "critical" && !quiet && "underline decoration-2 underline-offset-4",
        className,
      )}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}
