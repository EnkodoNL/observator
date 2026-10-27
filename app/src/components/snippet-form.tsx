// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULT_REPORTER_IMAGE, type SnippetForm } from "@/lib/snippet";

const STORAGE_KEY = "observator:snippet-form";

interface SnippetFormState {
  form: SnippetForm;
  setForm: (form: SnippetForm) => void;
  /** REPORTER_IMAGE: where the reporter comes from, such as a mirror. */
  image: string;
}

const Context = createContext<SnippetFormState>({
  form: "image",
  setForm: () => {},
  image: DEFAULT_REPORTER_IMAGE,
});

// The choice lives in localStorage, with a copy in memory for when storage is blocked.
let memory: SnippetForm = "image";
const listeners = new Set<() => void>();

function readForm(): SnippetForm {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "image" || stored === "shell") return stored;
  } catch {
    // Storage blocked: memory only.
  }
  return memory;
}

function writeForm(next: SnippetForm) {
  memory = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembered, still switched.
  }
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

/**
 * Which snippet the Setup views show: the reporter image or plain sh. One choice for the whole
 * app, so the steps, the pasted Dockerfile and the key dialogs agree; remembered per browser.
 */
export function SnippetFormProvider({ image, children }: { image: string; children: React.ReactNode }) {
  const form = useSyncExternalStore(subscribe, readForm, () => "image" as const);
  return <Context value={{ form, setForm: writeForm, image }}>{children}</Context>;
}

export const useSnippetForm = () => useContext(Context);

const DESCRIPTION: Record<SnippetForm, string> = {
  image:
    "A few lines: copies the small Observator reporter from its image and runs it. Works on any image, also without a shell (distroless). The build pulls the reporter from a registry.",
  shell:
    "Everything in plain sh, nothing to pull: works on any image with a shell and curl, wget, node or python3. It finds the runtimes (Node.js, Bun, Deno, Python, PHP, Ruby) itself.",
};

/** The switch between both forms, with what each one needs. */
export function SnippetFormToggle() {
  const { form, setForm } = useSnippetForm();
  return (
    <div className="space-y-2">
      <Tabs value={form} onValueChange={(v) => setForm(v as SnippetForm)}>
        <TabsList aria-label="Snippet">
          <TabsTrigger value="image">Reporter image</TabsTrigger>
          <TabsTrigger value="shell">Plain sh</TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="text-sm text-muted-foreground">{DESCRIPTION[form]}</p>
    </div>
  );
}
