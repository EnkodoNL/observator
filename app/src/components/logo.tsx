// SPDX-License-Identifier: FSL-1.1-ALv2
import { cn } from "@/lib/utils";

/** Observator mark: a lens with an off-centre pupil. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-5", className)} fill="none">
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="14.25" cy="9.75" r="3.25" className="fill-brand" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-medium tracking-tight", className)}>
      <LogoMark />
      Observator
    </span>
  );
}
