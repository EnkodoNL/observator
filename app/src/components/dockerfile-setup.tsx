// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useId, useState } from "react";
import { SnippetTabs } from "@/components/snippet-tabs";
import { Input } from "@/components/ui/input";
import { stageName } from "@/lib/snippet";
import { cn } from "@/lib/utils";

function Marker({ n }: { n: number }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-brand font-sans text-[10px] font-semibold text-background">
      {n}
    </span>
  );
}

/** One line of the sample; `tint` marks the lines that change, `mark` numbers the first of them. */
function Line({ mark, tint, children }: { mark?: number; tint?: boolean; children?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex min-h-[1.6em] items-center gap-2 border-l-2 pr-3 whitespace-pre",
        tint || mark ? "border-brand bg-brand/5 text-foreground" : "border-transparent text-muted-foreground",
      )}
    >
      <span className="flex w-6 shrink-0 justify-center">{mark && <Marker n={mark} />}</span>
      <span>{children}</span>
    </div>
  );
}

/** The stage name, tinted so the eye connects "AS app" with the snippet's "FROM app". */
function Stage({ name }: { name: string }) {
  return <span className="rounded bg-brand/15 px-1 font-semibold text-foreground">{name}</span>;
}

/**
 * Where the snippet goes, shown on a small sample Dockerfile with the two places that change,
 * followed by the snippet itself. The snippet follows the name of the user's last stage.
 */
export function DockerfileSetup({ url }: { url: string }) {
  const id = useId();
  const [raw, setRaw] = useState("app");
  const stage = stageName(raw);
  const invalid = raw.trim() !== "" && stage !== raw.trim().toLowerCase();

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border bg-muted/40 py-2 font-mono text-[12.5px] leading-relaxed">
        {/* w-max keeps the tint under the whole line when the sample scrolls sideways. */}
        <div className="w-max min-w-full">
          <Line>FROM node:24-alpine AS deps</Line>
          <Line>RUN npm ci</Line>
          <Line />
          <Line mark={1}>
            FROM node:24-alpine AS <Stage name={stage} />
          </Line>
          <Line>COPY --from=deps /app/node_modules ./node_modules</Line>
          <Line>COPY . .</Line>
          <Line>CMD [&quot;node&quot;, &quot;server.js&quot;]</Line>
          <Line />
          <Line mark={2}># --- Observator: reports Node version + lockfile ... ---</Line>
          <Line tint>
            FROM <Stage name={stage} /> AS observator
          </Line>
          <Line tint>...</Line>
          <Line tint>
            FROM <Stage name={stage} />
          </Line>
          <Line tint>COPY --from=observator /tmp/.observator /tmp/.observator</Line>
        </div>
      </div>

      <ol className="space-y-2 text-sm">
        <li className="flex gap-2">
          <span className="pt-0.5">
            <Marker n={1} />
          </span>
          <span>
            <span className="font-medium">Name your last stage.</span> The last{" "}
            <code className="font-mono">FROM</code> line is the image you deploy; add{" "}
            <code className="font-mono">AS {stage}</code> to it.{" "}
            <span className="text-muted-foreground">
              Does it already have a name, such as <code className="font-mono">AS runner</code>? Enter that
              name below and the snippet uses it.
            </span>
          </span>
        </li>
        <li className="flex gap-2">
          <span className="pt-0.5">
            <Marker n={2} />
          </span>
          <span>
            <span className="font-medium">Paste the snippet at the very bottom</span>, after everything else,{" "}
            <code className="font-mono">CMD</code> included.{" "}
            <span className="text-muted-foreground">
              It ends with <code className="font-mono">FROM {stage}</code>, so the image you build and deploy
              is still your app.
            </span>
          </span>
        </li>
      </ol>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label htmlFor={id} className="text-sm">
          Name of your last stage
        </label>
        <Input
          id={id}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className="h-8 w-40 font-mono"
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
        />
        {invalid && <span className="text-xs text-muted-foreground">Not a valid stage name, using app.</span>}
      </div>

      <SnippetTabs url={url} stage={stage} />

      <p className="text-xs text-muted-foreground">
        The last stage needs <code className="font-mono">package.json</code> and the lockfile in its working
        directory. If it only holds build output (a Next.js standalone image, for example), see
        &ldquo;Multi-stage builds&rdquo; in the README.
      </p>
    </div>
  );
}
