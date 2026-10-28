// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { CheckCircleIcon, InfoIcon, WarningIcon } from "@phosphor-icons/react/ssr";
import { CopyButton } from "@/components/copy-button";
import { SnippetFormToggle, useSnippetForm } from "@/components/snippet-form";
import { Textarea } from "@/components/ui/textarea";
import { analyzeDockerfile, type DockerfileLine, type DockerfileNote } from "@/lib/dockerfile";
import { cn } from "@/lib/utils";

const ICON: Record<DockerfileNote["level"], React.ReactNode> = {
  ok: <CheckCircleIcon className="size-4 text-ok" />,
  info: <InfoIcon className="size-4 text-muted-foreground" />,
  warn: <WarningIcon className="size-4 text-warn" />,
};

const CONTEXT = 2;

/** Which lines to show: the changes with a little context, unless everything is wanted. */
function visibleLines(lines: DockerfileLine[], all: boolean): (DockerfileLine | { hidden: number })[] {
  if (all) return lines;
  const near = (i: number) => lines.some((l, j) => l.added && Math.abs(i - j) <= CONTEXT);
  const out: (DockerfileLine | { hidden: number })[] = [];
  for (const [i, l] of lines.entries()) {
    if (near(i)) out.push(l);
    else if (out.length && "hidden" in out[out.length - 1])
      (out[out.length - 1] as { hidden: number }).hidden++;
    else out.push({ hidden: 1 });
  }
  return out;
}

/** Paste a Dockerfile, get it back with the snippet in place. Nothing leaves the browser. */
export function DockerfileCheck({ url, keyless = false }: { url: string; keyless?: boolean }) {
  const [text, setText] = useState("");
  const [all, setAll] = useState(false);
  const deferred = useDeferredValue(text);
  const { form, image } = useSnippetForm();
  const analysis = useMemo(
    () => (deferred.trim() ? analyzeDockerfile(deferred, url, { form, image, keyless }) : null),
    [deferred, url, form, image, keyless],
  );
  const result = analysis?.ok ? analysis.lines.map((l) => l.text).join("\n") + "\n" : "";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Paste your Dockerfile and get it back with Observator added, and an explanation of what changed. It is
        read in your browser and not sent anywhere.
      </p>
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setAll(false);
        }}
        rows={8}
        placeholder={"FROM node:24-alpine AS deps\nWORKDIR /app\nCOPY package.json pnpm-lock.yaml ./\n..."}
        className="max-h-80 font-mono text-[12.5px]"
        spellCheck={false}
        aria-label="Your Dockerfile"
      />

      {analysis && !analysis.ok && (
        <p role="alert" className="flex items-start gap-2 text-sm">
          <span className="pt-0.5">{ICON.warn}</span>
          {analysis.error}
        </p>
      )}

      {analysis?.ok && (
        <>
          <SnippetFormToggle />
          <ul className="space-y-1.5 text-sm">
            {analysis.notes.map((n) => (
              <li key={n.text} className="flex items-start gap-2">
                <span className="pt-0.5">{ICON[n.level]}</span>
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
          <div className="min-w-0 overflow-hidden rounded-lg border bg-muted/40">
            <div className="flex items-center justify-between gap-2 border-b py-1 pr-1 pl-3">
              <span className="font-mono text-xs text-muted-foreground">Dockerfile, changes marked</span>
              <CopyButton value={result} variant="ghost" />
            </div>
            <div className="max-h-[28rem] overflow-auto py-2 font-mono text-[12.5px] leading-relaxed">
              <div className="w-max min-w-full">
                {visibleLines(analysis.lines, all).map((l, i) =>
                  "hidden" in l ? (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setAll(true)}
                      className="flex w-full border-l-2 border-transparent py-0.5 pr-3 text-left font-sans text-xs text-muted-foreground hover:text-foreground"
                    >
                      <span className="w-6 shrink-0 text-center">⋯</span>
                      {l.hidden} unchanged line{l.hidden === 1 ? "" : "s"}
                    </button>
                  ) : (
                    <div
                      key={i}
                      className={cn(
                        "flex min-h-[1.6em] border-l-2 pr-3 whitespace-pre",
                        l.added
                          ? "border-brand bg-brand/5 text-foreground"
                          : "border-transparent text-muted-foreground",
                      )}
                    >
                      <span className="w-6 shrink-0 text-center text-brand select-none">
                        {l.added ? "+" : ""}
                      </span>
                      <span>{l.text}</span>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
