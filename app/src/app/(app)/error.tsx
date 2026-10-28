// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="font-display text-2xl font-bold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        Observator could not load this page. If PocketBase is restarting, trying again in a moment usually
        helps.
        {error.digest && (
          <>
            <br />
            <span className="font-mono text-xs">Reference: {error.digest}</span>
          </>
        )}
      </p>
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
