// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { CodeBlock } from "@/components/code-block";
import { dockerSnippet, type LockfileSource } from "@/lib/snippet";

/** The snippet as it goes at the bottom of the Dockerfile; one for every base image. */
export function SnippetBlock({
  url,
  stage,
  lockfileFrom,
  keyless,
}: {
  url: string;
  stage?: string;
  lockfileFrom?: LockfileSource;
  keyless?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Works on any image with a shell: it finds the runtimes (Node.js, Bun, Deno, Python, PHP, Ruby) and
        sends with curl, wget, node or python3, whichever the image has.
      </p>
      <CodeBlock
        code={dockerSnippet(url, { stage, lockfileFrom, keyless })}
        label="Dockerfile, at the very bottom"
      />
    </div>
  );
}
