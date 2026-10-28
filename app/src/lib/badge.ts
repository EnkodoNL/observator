// SPDX-License-Identifier: FSL-1.1-ALv2
import { escapeHtml } from "@/lib/notify/message";
import type { Severity } from "@/lib/pb/types";
import { countsText, worstCounted } from "@/lib/severity";
import type { ProjectStatus, StatusSummary } from "@/lib/status";

// Average glyph widths of Verdana 11px, close enough to size the boxes like shields.io.
const WIDE = /[MWmw@%]/;
const NARROW = /[iljI.,:;'| !]/;
function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += WIDE.test(ch) ? 9.5 : NARROW.test(ch) ? 3.5 : /[A-Z]/.test(ch) ? 7.5 : 6.6;
  return Math.ceil(w);
}

export const BADGE_COLORS = {
  ok: "#1f9d61",
  update: "#d68a00",
  vulnerable: "#d92d20",
  none: "#8a8f98",
} as const;

/** Red only for high and critical, as on the board. */
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: BADGE_COLORS.vulnerable,
  high: BADGE_COLORS.vulnerable,
  moderate: BADGE_COLORS.update,
  low: BADGE_COLORS.none,
  unknown: BADGE_COLORS.none,
};

/** "node update" or "node eol", for the first runtime that needs attention; null if none does. */
export function runtimeBadge(s: Pick<StatusSummary, "runtimeSecurity" | "runtimeEol">): string | null {
  const issue = s.runtimeSecurity[0] ?? s.runtimeEol[0];
  if (!issue) return null;
  const runtime = (issue.data as { runtime?: string } | null)?.runtime ?? "runtime";
  return `${runtime} ${s.runtimeSecurity.length ? "update" : "eol"}`;
}

/** What a badge says: "2 high, 10 moderate", "node update", "ok" or "no builds". */
export function badgeValue({
  status,
  counts,
  runtime,
}: {
  status: ProjectStatus;
  counts: Partial<Record<Severity, number>>;
  runtime: string | null;
}): { value: string; color: string } {
  const worst = worstCounted(counts);
  if (status === "vulnerable" && worst) return { value: countsText(counts), color: SEVERITY_COLOR[worst] };
  if (status === "update") return { value: runtime ?? "runtime update", color: BADGE_COLORS.update };
  if (status === "ok") return { value: "ok", color: BADGE_COLORS.ok };
  return { value: "no builds", color: BADGE_COLORS.none };
}

/** The SVG response, locked down: no scripts, nothing loaded from elsewhere. */
export const badgeResponse = (body: string, cache: string) =>
  new Response(body, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": cache,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });

/** Shown for a wrong token or an unknown badge, so a badge never tells whether something exists. */
export const unknownBadge = () =>
  badgeResponse(badgeSvg("observator", "unknown", BADGE_COLORS.none), "no-store");

/** A flat, shields.io-style badge: grey label on the left, coloured value on the right. */
export function badgeSvg(label: string, value: string, color: string): string {
  const pad = 10;
  const lw = textWidth(label) + pad;
  const vw = textWidth(value) + pad;
  const w = lw + vw;
  const l = escapeHtml(label);
  const v = escapeHtml(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${l}: ${v}">
<title>${l}: ${v}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${l}</text><text x="${lw / 2}" y="14">${l}</text>
<text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${v}</text><text x="${lw + vw / 2}" y="14">${v}</text>
</g></svg>`;
}
