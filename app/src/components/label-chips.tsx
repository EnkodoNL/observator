// SPDX-License-Identifier: FSL-1.1-ALv2
import { cn } from "@/lib/utils";

/** Labels as small chips; "key:" is dimmed so the value stands out. */
export function LabelChips({
  labels,
  max,
  className,
}: {
  labels: string[];
  max?: number;
  className?: string;
}) {
  if (labels.length === 0) return null;
  const shown = max ? labels.slice(0, max) : labels;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {shown.map((l) => {
        const i = l.indexOf(":");
        return (
          <span key={l} className="rounded-md border px-1.5 py-px font-mono text-[11px] leading-4">
            {i > 0 ? (
              <>
                <span className="text-muted-foreground">{l.slice(0, i + 1)}</span>
                {l.slice(i + 1)}
              </>
            ) : (
              l
            )}
          </span>
        );
      })}
      {max && labels.length > max && (
        <span className="px-1 text-[11px] leading-4 text-muted-foreground">+{labels.length - max}</span>
      )}
    </div>
  );
}
