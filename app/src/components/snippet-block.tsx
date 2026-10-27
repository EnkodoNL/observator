// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { CodeBlock } from "@/components/code-block";
import { SnippetFormToggle, useSnippetForm } from "@/components/snippet-form";
import { dockerSnippet, type LockfileSource } from "@/lib/snippet";

/** The snippet as it goes at the bottom of the Dockerfile, in the chosen form. */
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
  const { form, image } = useSnippetForm();
  return (
    <div className="space-y-3">
      <SnippetFormToggle />
      <CodeBlock
        code={dockerSnippet(url, { form, image, stage, lockfileFrom, keyless })}
        label="Dockerfile, at the very bottom"
      />
    </div>
  );
}
