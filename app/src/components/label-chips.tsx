// SPDX-License-Identifier: FSL-1.1-ALv2
import { cn } from "@/lib/utils";

/** Labels as plain words; "key:" is dimmed so the value stands out. */
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
    <div className={cn("flex flex-wrap gap-x-3 gap-y-0.5 text-sm", className)}>
      {shown.map((l) => {
        const i = l.indexOf(":");
        return (
          <span key={l}>
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
      {max && labels.length > max && <span className="text-muted-foreground">+{labels.length - max}</span>}
    </div>
  );
}
