// SPDX-License-Identifier: FSL-1.1-ALv2
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: "neutral" | "warn" | "danger" | "ok";
}) {
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl",
          tone === "warn" && "text-warn",
          tone === "danger" && "text-danger",
          tone === "ok" && "text-ok",
        )}
      >
        {value}
      </p>
      {detail && <p className="mt-1 hidden text-xs text-muted-foreground sm:block">{detail}</p>}
    </div>
  );
}
