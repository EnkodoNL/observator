// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import { Loader2Icon, MailPlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { CodeBlock } from "@/components/code-block";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createInviteAction, removeUserAction, resetTwoFactorAction, revokeInviteAction } from "./actions";

export function InviteButton({ days }: { days: number }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setLink(null);
          setEmail("");
        }
      }}
    >
      <DialogTrigger render={<Button />}>
        <MailPlusIcon /> Invite
      </DialogTrigger>
      <DialogContent className="grid-cols-1 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{link ? "Invite link" : "Invite someone"}</DialogTitle>
          <DialogDescription>
            {link
              ? `Send this link yourself. It works once and expires in ${days} days; it is not shown again.`
              : "Everyone with an account can see and change everything. There are no roles."}
          </DialogDescription>
        </DialogHeader>
        {link ? (
          <CodeBlock code={link} />
        ) : (
          <form
            id="invite-form"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await createInviteAction(email);
                if (res.error) toast.error(res.error);
                else setLink(res.link ?? null);
              });
            }}
          >
            <Field>
              <FieldLabel htmlFor="invite-email">
                E-mail <span className="font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <FieldDescription>Pre-fills the sign-up form; they can still change it.</FieldDescription>
            </Field>
          </form>
        )}
        <DialogFooter>
          {link ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <Button type="submit" form="invite-form" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Create invite link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RevokeInviteButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Revoke invite"
      disabled={pending}
      onClick={() => start(() => revokeInviteAction(id))}
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <XIcon />}
    </Button>
  );
}

export function RemoveUserButton({ id, email }: { id: string; email: string }) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${email}`}>
          <Trash2Icon />
        </Button>
      }
      title={`Remove ${email}?`}
      description="Their sessions and passkeys stop working immediately."
      confirmLabel="Remove user"
      destructive
      onConfirm={async () => {
        const res = await removeUserAction(id);
        if (res.error) toast.error(res.error);
        else toast.success(`Removed ${email}`);
      }}
    />
  );
}

export function ResetTwoFactorButton({ id, email }: { id: string; email: string }) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm">
          Reset 2FA
        </Button>
      }
      title={`Reset two-step verification for ${email}?`}
      description="Their authenticator app and recovery codes stop working. Their next sign-in with a password asks them to set up a new one; passkeys keep working."
      confirmLabel="Reset"
      destructive
      onConfirm={async () => {
        const res = await resetTwoFactorAction(id);
        if (res.error) toast.error(res.error);
        else toast.success(`Two-step verification reset for ${email}`);
      }}
    />
  );
}
