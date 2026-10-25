// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Severity } from "@/lib/pb/types";
import type { OsvVuln } from "./types";

const roundUp = (n: number) => {
  const i = Math.round(n * 100000);
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
};

/** CVSS 3.0/3.1 base score from a vector string, or null if it cannot be parsed. */
export function cvss3BaseScore(vector: string): number | null {
  const m = Object.fromEntries(
    vector
      .split("/")
      .slice(1)
      .map((p) => p.split(":")),
  ) as Record<string, string>;
  const W = {
    AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
    AC: { L: 0.77, H: 0.44 },
    UI: { N: 0.85, R: 0.62 },
    CIA: { H: 0.56, L: 0.22, N: 0 },
  } as const;
  const scopeChanged = m.S === "C";
  const pr = { N: 0.85, L: scopeChanged ? 0.68 : 0.62, H: scopeChanged ? 0.5 : 0.27 }[
    m.PR as "N" | "L" | "H"
  ];
  const av = W.AV[m.AV as keyof typeof W.AV];
  const ac = W.AC[m.AC as keyof typeof W.AC];
  const ui = W.UI[m.UI as keyof typeof W.UI];
  const [c, i, a] = [m.C, m.I, m.A].map((x) => W.CIA[x as keyof typeof W.CIA]);
  if ([pr, av, ac, ui, c, i, a].some((x) => x === undefined) || !vector.startsWith("CVSS:3")) return null;

  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploitability = 8.22 * av * ac * pr * ui;
  if (impact <= 0) return 0;
  return scopeChanged
    ? roundUp(Math.min(1.08 * (impact + exploitability), 10))
    : roundUp(Math.min(impact + exploitability, 10));
}

export function severityFromScore(score: number): Severity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "moderate";
  if (score > 0) return "low";
  return "unknown";
}

/** GHSA's own rating wins; otherwise derive it from a CVSS v3 vector. */
export function osvSeverity(vuln: OsvVuln): Severity {
  const ghsa = vuln.database_specific?.severity?.toLowerCase();
  if (ghsa === "critical" || ghsa === "high" || ghsa === "moderate" || ghsa === "low") return ghsa;
  if (ghsa === "medium") return "moderate";
  for (const s of vuln.severity ?? []) {
    if (s.type === "CVSS_V3") {
      const score = cvss3BaseScore(s.score);
      if (score !== null) return severityFromScore(score);
    }
  }
  return "unknown";
}
