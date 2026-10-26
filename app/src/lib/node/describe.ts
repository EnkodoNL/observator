// SPDX-License-Identifier: FSL-1.1-ALv2
import { PHASE_LABEL, type NodeEvaluation } from "@/lib/node/evaluate";
import { formatDate } from "@/lib/time";

/** "Node 22 · Jod · Maintenance LTS until 30 Apr 2027", or null without release data. */
export function lineDescription(evaluation: NodeEvaluation | null): string | null {
  if (!evaluation || evaluation.phase === "unknown") return null;
  const name = evaluation.codename ? `${evaluation.codename} · ` : "";
  const until = evaluation.end
    ? evaluation.phase === "eol"
      ? ` since ${formatDate(new Date(evaluation.end))}`
      : ` until ${formatDate(new Date(evaluation.end))}`
    : "";
  return `Node ${evaluation.major} · ${name}${PHASE_LABEL[evaluation.phase]}${until}`;
}
