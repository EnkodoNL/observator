// SPDX-License-Identifier: FSL-1.1-ALv2
import { escapeHtml } from "@/lib/notify/message";

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
