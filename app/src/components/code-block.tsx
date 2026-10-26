// SPDX-License-Identifier: FSL-1.1-ALv2
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

/** The code with every occurrence of `placeholder` marked, for a value the user still has to fill in. */
function Highlighted({ code, placeholder }: { code: string; placeholder?: string }) {
  if (!placeholder || !code.includes(placeholder)) return code;
  return code.split(placeholder).flatMap((part, i) =>
    i === 0
      ? [part]
      : [
          <mark key={i} className="rounded-sm bg-danger/10 px-0.5 text-danger">
            {placeholder}
          </mark>,
          part,
        ],
  );
}

export function CodeBlock({
  code,
  label,
  className,
  copy = true,
  placeholder,
}: {
  code: string;
  label?: string;
  className?: string;
  copy?: boolean;
  /** Part of `code` to mark in red, such as a key that is not shown again. */
  placeholder?: string;
}) {
  const multiline = code.includes("\n");

  if (!multiline) {
    return (
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-3",
          className,
        )}
      >
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[12.5px] whitespace-nowrap">
          <Highlighted code={code} placeholder={placeholder} />
        </code>
        {copy && <CopyButton value={code} variant="ghost" />}
      </div>
    );
  }

  return (
    <div className={cn("min-w-0 overflow-hidden rounded-lg border bg-muted/40", className)}>
      {(label || copy) && (
        <div className="flex items-center justify-between gap-2 border-b py-1 pr-1 pl-3">
          <span className="font-mono text-xs text-muted-foreground">{label}</span>
          {copy && <CopyButton value={code} variant="ghost" />}
        </div>
      )}
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed">
        <code>
          <Highlighted code={code} placeholder={placeholder} />
        </code>
      </pre>
    </div>
  );
}
