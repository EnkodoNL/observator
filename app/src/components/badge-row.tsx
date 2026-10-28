// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { rotateBadgeAction, type BadgeTarget } from "@/app/(app)/settings/badges/actions";
import type { BadgeLinks } from "@/lib/badges";
import { cn } from "@/lib/utils";

/** One badge: what it looks like now, copy it for a README, or give it a new token. */
export function BadgeRow({
  name,
  links,
  target,
  className,
}: {
  /** What the badge is for, in the confirm dialog: "sip-helper", "this server". */
  name: string;
  links: BadgeLinks;
  target: BadgeTarget;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={links.src} alt={`Observator badge for ${name}`} height={20} className="h-5" />
      <span className="flex flex-wrap items-center gap-1">
        <CopyButton value={links.markdown} label="Markdown" variant="ghost" />
        <CopyButton value={links.html} label="HTML" variant="ghost" />
        <ConfirmDialog
          trigger={
            <Button type="button" size="sm" variant="ghost" className="text-muted-foreground">
              New token
            </Button>
          }
          title={`New badge token for ${name}?`}
          description="The badge stays public, but under a new link. READMEs with the current link show “unknown” until you paste the new one."
          confirmLabel="New token"
          onConfirm={() => rotateBadgeAction(target)}
        />
      </span>
    </div>
  );
}
