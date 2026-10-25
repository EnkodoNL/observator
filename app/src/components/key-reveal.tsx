// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { CodeBlock } from "@/components/code-block";
import { SnippetTabs } from "@/components/snippet-tabs";
import { buildCommand } from "@/lib/snippet";

/** Shows a freshly created or rotated API key, once, with what to do with it. */
export function KeyReveal({ apiKey, appUrl }: { apiKey: string; appUrl: string }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">API key</p>
        <p className="text-sm text-muted-foreground">
          Copy it now: Observator only stores a hash and cannot show it again.
        </p>
        <CodeBlock code={apiKey} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">1. Add this to the end of your Dockerfile</p>
        <p className="text-sm text-muted-foreground">
          Name your final stage <code className="font-mono text-foreground">app</code> (
          <code className="font-mono text-foreground">FROM node:22-alpine AS app</code>). The snippet contains
          no secrets, so it is safe to commit.
        </p>
        <SnippetTabs url={appUrl} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">2. Pass the key as a build argument</p>
        <p className="text-sm text-muted-foreground">
          In Coolify, add <code className="font-mono text-foreground">OBSERVATOR_KEY</code> as an environment
          variable and tick &ldquo;Build Variable&rdquo;. Locally:
        </p>
        <CodeBlock code={buildCommand(apiKey)} />
      </div>
    </div>
  );
}
