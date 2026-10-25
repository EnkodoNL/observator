// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Updates ?q= as you type (debounced), so results are shareable links. */
export function SearchBox({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (value.trim() === initial.trim()) return;
    const t = setTimeout(() => {
      const q = value.trim();
      router.replace(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [value, initial, pathname, router]);

  return (
    <div className="relative max-w-md">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Package name, e.g. lodash"
        className="h-10 pl-9 text-base"
        autoFocus
        aria-label="Search packages"
        spellCheck={false}
      />
    </div>
  );
}
