// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import {
  FingerprintIcon,
  KeyRoundIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { guessDeviceName, passkeyError, registerPasskey } from "@/lib/auth/passkey-client";
import { deletePasskeyAction, renamePasskeyAction } from "./actions";

export interface PasskeyItem {
  id: string;
  name: string;
  synced: boolean;
  created: string;
  lastUsed: string;
}

export function Passkeys({ passkeys }: { passkeys: PasskeyItem[] }) {
  const router = useRouter();
  const [naming, setNaming] = useState<{ mode: "add" } | { mode: "rename"; id: string } | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<PasskeyItem | null>(null);
  const [pending, start] = useTransition();

  const submitName = () =>
    start(async () => {
      if (naming?.mode === "add") {
        try {
          await registerPasskey(name);
          toast.success("Passkey added");
          setNaming(null);
          router.refresh();
        } catch (err) {
          const message = passkeyError(err);
          if (message) toast.error(message);
        }
      } else if (naming?.mode === "rename") {
        await renamePasskeyAction(naming.id, name);
        setNaming(null);
      }
    });

  return (
    <div className="space-y-3">
      {passkeys.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          No passkeys yet. Add one to sign in with Touch ID, Windows Hello or your phone instead of a
          password.
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.synced ? "Synced" : "This device only"} · added {p.created}
                  {p.lastUsed && ` · last used ${p.lastUsed}`}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.name}`} />}
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    onClick={() => {
                      setName(p.name);
                      setNaming({ mode: "rename", id: p.id });
                    }}
                  >
                    <PencilIcon /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleting(p)}>
                    <Trash2Icon /> Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="outline"
        onClick={() => {
          if (!browserSupportsWebAuthn()) {
            toast.error("This browser does not support passkeys.");
            return;
          }
          setName(guessDeviceName());
          setNaming({ mode: "add" });
        }}
      >
        <FingerprintIcon /> Add passkey
      </Button>

      <Dialog open={naming !== null} onOpenChange={(open) => !open && setNaming(null)}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitName();
            }}
          >
            <DialogHeader className="mb-4">
              <DialogTitle>{naming?.mode === "add" ? "Add a passkey" : "Rename passkey"}</DialogTitle>
              <DialogDescription>
                {naming?.mode === "add"
                  ? "Name it after the device or password manager that holds it."
                  : "Only you see this name."}
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="passkey-name">Name</FieldLabel>
              <Input
                id="passkey-name"
                value={name}
                maxLength={100}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <DialogFooter className="mt-4">
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending && <Loader2Icon className="animate-spin" />}
                {naming?.mode === "add" ? "Continue" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Remove ${deleting?.name ?? "passkey"}?`}
        description="You can no longer sign in with it. Remove it from your device or password manager as well."
        confirmLabel="Remove passkey"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deletePasskeyAction(deleting.id);
          if (res.error) toast.error(res.error);
          else toast.success("Passkey removed");
        }}
      />
    </div>
  );
}
