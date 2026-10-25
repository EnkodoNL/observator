// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { CodeBlock } from "@/components/code-block";
import { DockerfileSetup } from "@/components/dockerfile-setup";
import { buildCommand } from "@/lib/snippet";

/** Shows a freshly created or rotated API key, once, with what to do with it. */
export function KeyReveal({ apiKey, appUrl, shared }: { apiKey: string; appUrl: string; shared?: boolean }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">{shared ? "Shared key" : "API key"}</p>
        <p className="text-sm text-muted-foreground">
          Copy it now: Observator only stores a hash and cannot show it again.
        </p>
        <CodeBlock code={apiKey} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">1. Add Observator to your Dockerfile</p>
        <p className="text-sm text-muted-foreground">
          The snippet contains no secrets, so it is safe to commit.
        </p>
        <DockerfileSetup url={appUrl} />
      </div>
      {shared ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">2. Pass the key and a project name as build arguments</p>
          <p className="text-sm text-muted-foreground">
            Give every app the same <code className="font-mono text-foreground">OBSERVATOR_KEY</code> and its
            own <code className="font-mono text-foreground">OBSERVATOR_PROJECT</code> (in Coolify: environment
            variables with &ldquo;Build Variable&rdquo; ticked). Without a project name, the name from
            package.json is used. The project is created on its first report. Locally:
          </p>
          <CodeBlock code={buildCommand(apiKey, "my-api")} />
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium">2. Pass the key as a build argument</p>
          <p className="text-sm text-muted-foreground">
            In Coolify, add <code className="font-mono text-foreground">OBSERVATOR_KEY</code> as an
            environment variable and tick &ldquo;Build Variable&rdquo;. Locally:
          </p>
          <CodeBlock code={buildCommand(apiKey)} />
        </div>
      )}
    </div>
  );
}
