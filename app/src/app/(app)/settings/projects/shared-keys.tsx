// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import { KeyRoundIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { KeyReveal } from "@/components/key-reveal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createSharedKeyAction, revokeSharedKeyAction } from "./actions";

export interface SharedKeyItem {
  id: string;
  name: string;
  prefix: string;
  splitByIp: boolean;
  projects: number;
  lastUsed: string;
  lastUsedIp: string;
}

export function NewSharedKeyDialog({ appUrl }: { appUrl: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [split, setSplit] = useState(true);
  const [key, setKey] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setKey(null);
          setName("");
          setSplit(true);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <PlusIcon /> New shared key
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] grid-cols-1 overflow-y-auto sm:max-w-2xl">
        {key ? (
          <>
            <DialogHeader>
              <DialogTitle>{name} is ready</DialogTitle>
              <DialogDescription>
                One write-only key for all your apps. Each app names its project.
              </DialogDescription>
            </DialogHeader>
            <KeyReveal apiKey={key} appUrl={appUrl} shared />
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await createSharedKeyAction(name, split);
                if (res.error) toast.error(res.error);
                else setKey(res.key ?? null);
              });
            }}
          >
            <DialogHeader className="mb-4">
              <DialogTitle>New shared key</DialogTitle>
              <DialogDescription>
                Give every app the same key plus a project name; projects are created on their first report.
                The key can only report, and only to the projects it created itself.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Field>
                <FieldLabel htmlFor="sk-name">Name</FieldLabel>
                <Input
                  id="sk-name"
                  value={name}
                  placeholder="Coolify servers"
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox className="mt-0.5" checked={split} onCheckedChange={(v) => setSplit(Boolean(v))} />
                <span>
                  <span className="font-medium">One project per server</span>
                  <span className="block text-muted-foreground">
                    The same name from different source IPs becomes separate projects, so a load-balanced
                    replica that lags behind shows up on its own. Turn this off for CI runners, whose IP
                    changes every build.
                  </span>
                </span>
              </label>
            </div>
            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending && <Loader2Icon className="animate-spin" />}
                Create shared key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SharedKeyList({ keys }: { keys: SharedKeyItem[] }) {
  const [revoking, setRevoking] = useState<SharedKeyItem | null>(null);
  if (keys.length === 0) return null;
  return (
    <>
      <ul className="divide-y rounded-xl border">
        {keys.map((k) => (
          <li key={k.id} className="flex items-center gap-3 px-4 py-3">
            <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {k.name}{" "}
                <span className="font-mono text-xs font-normal text-muted-foreground">{k.prefix}…</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {k.projects} project{k.projects === 1 ? "" : "s"} ·{" "}
                {k.splitByIp ? "one per server" : "one per name"} ·{" "}
                {k.lastUsed ? `last used ${k.lastUsed} from ${k.lastUsedIp}` : "never used"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Revoke ${k.name}`}
              onClick={() => setRevoking(k)}
            >
              <Trash2Icon />
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Revoke ${revoking?.name ?? "key"}?`}
        description="Builds using it keep working but stop reporting. Its projects stay, with their history; to keep them reporting, give each its own key (Rotate API key)."
        confirmLabel="Revoke key"
        destructive
        onConfirm={async () => {
          if (revoking) await revokeSharedKeyAction(revoking.id);
          toast.success("Shared key revoked");
        }}
      />
    </>
  );
}
