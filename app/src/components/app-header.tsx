// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { GearIcon, MonitorIcon, MoonIcon, SignOutIcon, SunIcon, UserIcon } from "@phosphor-icons/react/ssr";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/app/(auth)/actions";

const NAV = [
  { href: "/", label: "Overview", match: (p: string) => p === "/" || p.startsWith("/projects") },
  { href: "/runtimes", label: "Runtimes", match: (p: string) => p.startsWith("/runtimes") },
  { href: "/packages", label: "Packages", match: (p: string) => p.startsWith("/packages") },
  // On a phone Settings moves into the account menu, so the rest fits without scrolling.
  { href: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings"), wide: true },
] as const;

export function AppHeader({ email, actions }: { email: string; actions?: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="shrink-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo compact />
        </Link>
        <nav className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-sm px-2 py-1.5 text-sm whitespace-nowrap text-muted-foreground underline-offset-[9px] transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring",
                  active && "text-foreground underline decoration-primary decoration-2",
                  "wide" in item && "hidden sm:block",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Account menu" />}>
              <UserIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Theme</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(v) => setTheme(String(v))}>
                  <DropdownMenuRadioItem value="light">
                    <SunIcon /> Light
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <MoonIcon /> Dark
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <MonitorIcon /> System
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/settings/account" />}>
                <UserIcon /> Account
              </DropdownMenuItem>
              <DropdownMenuItem className="sm:hidden" render={<Link href="/settings" />}>
                <GearIcon /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void logoutAction()}>
                <SignOutIcon /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
