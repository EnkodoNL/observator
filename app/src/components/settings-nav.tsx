// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings/general", label: "General" },
  { href: "/settings/projects", label: "Projects" },
  { href: "/settings/badges", label: "Badges" },
  { href: "/settings/channels", label: "Notifications" },
  { href: "/settings/account", label: "Account", personal: true },
  { href: "/settings/users", label: "Users", personal: true },
];

/** demo: the read-only demo, which has no account and shows no users. */
export function SettingsNav({ demo = false }: { demo?: boolean }) {
  const pathname = usePathname();
  return (
    // The active item is marked like the header: an indigo line, under it on a phone and
    // beside it in the column.
    <nav className="-mx-1 flex gap-1 overflow-x-auto md:mx-0 md:flex-col md:gap-0 md:border-l">
      {ITEMS.filter((item) => !(demo && "personal" in item)).map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-sm px-2 py-1.5 text-sm whitespace-nowrap text-muted-foreground underline-offset-[9px] transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring md:-ml-px md:rounded-none md:border-l-2 md:border-transparent md:px-3",
              active &&
                "text-foreground underline decoration-primary decoration-2 md:border-primary md:no-underline",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
