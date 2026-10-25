// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings/general", label: "General" },
  { href: "/settings/projects", label: "Projects" },
  { href: "/settings/channels", label: "Notifications" },
  { href: "/settings/account", label: "Account" },
  { href: "/settings/users", label: "Users" },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto md:mx-0 md:flex-col">
      {ITEMS.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
              active && "bg-muted text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
