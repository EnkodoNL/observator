// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useSearchParams } from "next/navigation";
import { EyeIcon } from "@phosphor-icons/react/ssr";
import { cn } from "@/lib/utils";

/**
 * Shown to every demo visitor. An action that would change something sends them back with
 * ?demo=read-only; the banner then says so more loudly.
 */
export function DemoBanner() {
  const refused = useSearchParams().get("demo") === "read-only";
  return (
    <div
      role={refused ? "alert" : undefined}
      className={cn(
        "border-b text-sm",
        refused ? "bg-warn/10 text-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      <p className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 sm:px-6">
        <EyeIcon className="size-4 shrink-0" />
        {refused ? (
          <span>
            <b>Not saved.</b> This is a read-only demo: you can look around, but nothing changes.
          </span>
        ) : (
          <span>A read-only demo of Observator: look around freely, nothing you do is saved.</span>
        )}
      </p>
    </div>
  );
}
