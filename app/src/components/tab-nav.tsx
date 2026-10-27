// SPDX-License-Identifier: FSL-1.1-ALv2
import Link from "next/link";
import { cn } from "@/lib/utils";

export function TabNav({
  base,
  active,
  tabs,
}: {
  base: string;
  active: string;
  tabs: { id: string; label: string; count?: number }[];
}) {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab, i) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={i === 0 ? base : `${base}?tab=${tab.id}`}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative -mb-px flex items-center gap-1.5 border-b-2 border-transparent px-2.5 py-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
              isActive && "border-primary text-foreground",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
                {tab.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
