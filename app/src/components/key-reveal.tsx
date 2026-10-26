// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { CodeBlock } from "@/components/code-block";
import { DockerfileSetup } from "@/components/dockerfile-setup";
import { buildCommand } from "@/lib/snippet";

/**
 * Shows a freshly created or rotated API key, once, with what to do with it. Without the key
 * (opened again later) the same steps show its prefix as a placeholder, marked red.
 */
export function KeyReveal({
  apiKey,
  prefix,
  appUrl,
  shared,
}: {
  apiKey: string | null;
  /** "obss_ab12", for the placeholder when the key itself is gone. */
  prefix?: string;
  appUrl: string;
  shared?: boolean;
}) {
  // Not a usable value on purpose: pasted unchanged, the shell refuses the < and >.
  const placeholder = `<${prefix ?? (shared ? "obss_" : "obs_")}…>`;
  const key = apiKey ?? placeholder;
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">{shared ? "Shared key" : "API key"}</p>
        {apiKey ? (
          <>
            <p className="text-sm text-muted-foreground">
              Copy it now: Observator only stores a hash and cannot show it again.
            </p>
            <CodeBlock code={apiKey} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Shown once, when it was created: Observator only stores a hash. Use the key you saved, starting
            with <code className="font-mono text-foreground">{prefix}</code>, where the steps below say{" "}
            <code className="font-mono text-danger">{placeholder}</code>. Lost it? Create a new shared key,
            move your apps to it, then revoke this one.
          </p>
        )}
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
          <CodeBlock code={buildCommand(key, "my-api")} placeholder={apiKey ? undefined : placeholder} />
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium">2. Pass the key as a build argument</p>
          <p className="text-sm text-muted-foreground">
            In Coolify, add <code className="font-mono text-foreground">OBSERVATOR_KEY</code> as an
            environment variable and tick &ldquo;Build Variable&rdquo;. Locally:
          </p>
          <CodeBlock code={buildCommand(key)} placeholder={apiKey ? undefined : placeholder} />
        </div>
      )}
    </div>
  );
}
