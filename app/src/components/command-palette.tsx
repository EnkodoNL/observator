// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderIcon, GearIcon, MagnifyingGlassIcon, PackageIcon, PlusIcon } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { searchPackageNamesAction } from "@/app/(app)/palette-actions";
import { packageHref } from "@/lib/package-href";

const PAGES = [
  { label: "Overview", href: "/" },
  { label: "Runtimes", href: "/runtimes" },
  { label: "Packages", href: "/packages" },
  { label: "Settings: General", href: "/settings/general" },
  { label: "Settings: Projects", href: "/settings/projects" },
  { label: "Settings: Notifications", href: "/settings/channels" },
  { label: "Settings: Account", href: "/settings/account" },
  { label: "Settings: Users", href: "/settings/users" },
];

export function CommandPalette({ projects }: { projects: { name: string; slug: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [packages, setPackages] = useState<{ name: string; projects: number }[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const result = await searchPackageNamesAction(q);
      if (!cancelled) setPackages(result);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="hidden w-48 justify-start text-muted-foreground md:inline-flex"
        onClick={() => setOpen(true)}
      >
        <MagnifyingGlassIcon />
        Search
        <kbd className="ml-auto rounded border bg-muted px-1 font-mono text-[10px]">⌘K</kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Search"
        onClick={() => setOpen(true)}
      >
        <MagnifyingGlassIcon />
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery("");
        }}
        title="Search"
        description="Jump to a project, a package or a page"
      >
        <Command>
          <CommandInput placeholder="Project, package or page…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            {projects.length > 0 && (
              <CommandGroup heading="Projects">
                {projects.map((p) => (
                  <CommandItem
                    key={p.slug}
                    value={`project ${p.name} ${p.slug}`}
                    onSelect={() => go(`/projects/${p.slug}`)}
                  >
                    <FolderIcon />
                    {p.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {query.trim().length >= 2 && packages.length > 0 && (
              <CommandGroup heading="Packages">
                {packages.map((p) => (
                  <CommandItem
                    key={p.name}
                    value={`package ${p.name}`}
                    onSelect={() => go(packageHref(p.name))}
                  >
                    <PackageIcon />
                    <span className="font-mono">{p.name}</span>
                    <CommandShortcut>
                      {p.projects} project{p.projects === 1 ? "" : "s"}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Go to">
              <CommandItem value="new project create" onSelect={() => go("/settings/projects")}>
                <PlusIcon />
                New project
              </CommandItem>
              {PAGES.map((p) => (
                <CommandItem key={p.href} value={`page ${p.label}`} onSelect={() => go(p.href)}>
                  <GearIcon />
                  {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
