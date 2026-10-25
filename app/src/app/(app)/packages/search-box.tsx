// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Updates ?q= as you type (debounced), so results are shareable links. */
export function SearchBox({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  // A q this box did not write came from elsewhere (a link, back/forward) and replaces what is
  // typed; otherwise the debounce below would write the old text back. Its own recent writes
  // are remembered, so a slow navigation does not undo what was typed meanwhile.
  const [seen, setSeen] = useState(initial);
  const [written, setWritten] = useState<string[]>([]);
  if (initial !== seen) {
    setSeen(initial);
    if (!written.includes(initial)) setValue(initial);
  }
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const q = value.trim();
    if (q === initial.trim()) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (q) params.set("q", q);
      else params.delete("q");
      setWritten((w) => [...w.slice(-9), q]);
      const search = params.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [value, initial, pathname, router, searchParams]);

  return (
    <div className="relative w-full sm:w-80">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Filter by name, e.g. lodash"
        className="h-9 pl-9"
        aria-label="Filter packages"
        spellCheck={false}
      />
    </div>
  );
}
