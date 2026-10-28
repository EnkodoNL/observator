// SPDX-License-Identifier: FSL-1.1-ALv2
import { CaretDownIcon } from "@phosphor-icons/react/ssr";
import { cn } from "@/lib/utils";

/** A native <select> styled like the inputs: accessible and form-friendly. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select
        className="h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:bg-input/30 [&>option]:bg-popover"
        {...props}
      >
        {children}
      </select>
      <CaretDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
