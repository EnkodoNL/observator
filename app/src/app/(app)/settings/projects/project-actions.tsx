// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import { DotsThreeIcon, KeyIcon, ShieldCheckIcon, TrashIcon } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { KeyReveal } from "@/components/key-reveal";
import { deleteProjectAction, rotateKeyAction } from "./actions";

export function ProjectActions({
  id,
  name,
  appUrl,
  badge,
  sharedKey,
}: {
  id: string;
  name: string;
  appUrl: string;
  /** The project badge as Markdown, for a README. */
  badge?: string;
  /** The shared key that created the project; it keeps reporting to it after a rotate. */
  sharedKey?: string;
}) {
  const [confirm, setConfirm] = useState<"rotate" | "delete" | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`} />}
        >
          <DotsThreeIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {badge && (
            <DropdownMenuItem
              onClick={async () => {
                await navigator.clipboard.writeText(badge);
                toast.success("Badge copied as Markdown");
              }}
            >
              <ShieldCheckIcon /> Copy badge
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setConfirm("rotate")}>
            <KeyIcon /> Rotate API key
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm("delete")}>
            <TrashIcon /> Delete project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirm === "rotate"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Rotate the key for ${name}?`}
        description={
          <>
            The current key stops working immediately. Builds using it will keep succeeding but stop reporting
            until you update the build variable.
            {sharedKey && (
              <>
                {" "}
                The shared key &ldquo;{sharedKey}&rdquo; (and its IP allowlist) can still report to this
                project; revoke or change that key under Shared keys to stop it.
              </>
            )}
          </>
        }
        confirmLabel="Rotate key"
        onConfirm={async () => {
          const { apiKey } = await rotateKeyAction(id);
          setNewKey(apiKey);
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Delete ${name}?`}
        description="This removes the project with all its builds, packages and issues. It cannot be undone."
        confirmLabel="Delete project"
        destructive
        onConfirm={async () => {
          await deleteProjectAction(id);
          toast.success(`Deleted ${name}`);
        }}
      />
      <Dialog open={newKey !== null} onOpenChange={(open) => !open && setNewKey(null)}>
        <DialogContent className="max-h-[90vh] grid-cols-1 overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New key for {name}</DialogTitle>
            <DialogDescription>The old key no longer works.</DialogDescription>
          </DialogHeader>
          {newKey && <KeyReveal apiKey={newKey} appUrl={appUrl} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
