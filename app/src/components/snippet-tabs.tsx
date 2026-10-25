// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { CodeBlock } from "@/components/code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dockerSnippet, type LockfileSource, SNIPPET_VARIANTS } from "@/lib/snippet";

export function SnippetTabs({
  url,
  stage,
  lockfileFrom,
}: {
  url: string;
  stage?: string;
  lockfileFrom?: LockfileSource;
}) {
  return (
    <Tabs defaultValue="alpine">
      <TabsList>
        {SNIPPET_VARIANTS.map((v) => (
          <TabsTrigger key={v.id} value={v.id}>
            {v.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {SNIPPET_VARIANTS.map((v) => (
        <TabsContent key={v.id} value={v.id} className="space-y-2">
          <p className="text-sm text-muted-foreground">{v.hint}</p>
          <CodeBlock
            code={dockerSnippet(v.id, url, stage, lockfileFrom)}
            label="Dockerfile, at the very bottom"
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
