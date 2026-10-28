// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { randomToken } from "@/lib/crypto";
import { adminPb } from "@/lib/pb/admin";
import { kvEnsure, kvGet, kvSet } from "@/lib/kv";

const appKey = (id: string) => `badge:app:${id}`;

/** The app badge's token, made on first use; the badge stays public through it. */
export const appBadgeToken = (id: string): Promise<string> => kvEnsure(appKey(id), randomToken(18));

/** The stored token, without making one: for the public route. */
export const storedAppBadgeToken = (id: string): Promise<string | null> => kvGet<string>(appKey(id));

/** A new token for the app badge; READMEs with the old one show "unknown". */
export async function rotateAppBadge(id: string): Promise<void> {
  await kvSet(appKey(id), randomToken(18));
}

/** A new token for the project badge. */
export async function rotateProjectBadge(projectId: string): Promise<void> {
  const pb = await adminPb();
  await pb.collection("projects").update(projectId, { badgeToken: randomToken(18) });
}

export interface BadgeLinks {
  /** Relative, for the preview here. */
  src: string;
  markdown: string;
  html: string;
}

/** The badge as an image that links back to `href`, ready to paste into a README. */
export function badgeLinks(appUrl: string, path: string, token: string, href: string): BadgeLinks {
  const src = `${path}?token=${token}`;
  const img = `${appUrl}${src}`;
  const link = `${appUrl}${href}`;
  return {
    src,
    markdown: `[![Observator](${img})](${link})`,
    html: `<a href="${link}"><img src="${img}" alt="Observator"></a>`,
  };
}

export const projectBadge = (appUrl: string, project: { slug: string; badgeToken: string }) =>
  badgeLinks(appUrl, `/badge/${project.slug}.svg`, project.badgeToken, `/projects/${project.slug}`);

export const appBadge = (appUrl: string, id: string, token: string) =>
  badgeLinks(appUrl, `/badge/app/${id}.svg`, token, `/?label=${encodeURIComponent(`app:${id}`)}`);
