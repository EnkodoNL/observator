// SPDX-License-Identifier: FSL-1.1-ALv2
import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <LogoMark className="size-8 text-muted-foreground" />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Nothing to observe here</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This page does not exist, or the project was deleted.
        </p>
      </div>
      <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
        Back to the overview
      </Button>
    </main>
  );
}
