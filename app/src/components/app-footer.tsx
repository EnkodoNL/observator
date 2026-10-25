// SPDX-License-Identifier: FSL-1.1-ALv2
import { VERSION } from "@/lib/version";

export function AppFooter({ sourceUrl }: { sourceUrl: string }) {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
        <span>Observator {VERSION}</span>
        <span>
          Source available under the{" "}
          <a className="underline-offset-4 hover:text-foreground hover:underline" href="https://fsl.software">
            FSL-1.1
          </a>
          {" · "}
          <a className="underline-offset-4 hover:text-foreground hover:underline" href={sourceUrl}>
            Source code
          </a>
        </span>
      </div>
    </footer>
  );
}
