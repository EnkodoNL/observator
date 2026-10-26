// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { LabelChips } from "@/components/label-chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseLabels } from "@/lib/labels";
import { updateLabelsAction } from "./actions";

/** Labels kept by hand, with the build's own labels shown next to them. */
export function LabelsEditor({
  projectId,
  labels,
  buildLabels,
}: {
  projectId: string;
  labels: string[];
  buildLabels: string[];
}) {
  const [text, setText] = useState(labels.join(", "));
  const [pending, start] = useTransition();
  const { invalid } = parseLabels(text);

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateLabelsAction(projectId, text);
          if (res.error) toast.error(res.error);
          else toast.success("Labels saved");
        });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="app:heatwave, env:prod, client:acme"
          aria-label="Labels"
          className="max-w-md flex-1 font-mono text-[13px]"
          spellCheck={false}
          autoCapitalize="none"
        />
        <Button type="submit" variant="outline" disabled={pending || invalid.length > 0}>
          {pending && <Loader2Icon className="animate-spin" />}
          Save labels
        </Button>
      </div>
      {invalid.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          Not a label: {invalid.join(", ")}. Use a word or key:value, with a-z, 0-9 and . _ - /.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          From the latest build (<code className="font-mono">OBSERVATOR_LABELS</code>):
        </span>
        {buildLabels.length > 0 ? <LabelChips labels={buildLabels} /> : <span>none</span>}
      </div>
    </form>
  );
}
