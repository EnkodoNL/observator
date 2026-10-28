// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import {
  BookOpenIcon,
  CircleNotchIcon,
  KeyIcon,
  PlusIcon,
  TrashIcon,
  TreeStructureIcon,
} from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DockerfileSetup } from "@/components/dockerfile-setup";
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
import { Textarea } from "@/components/ui/textarea";
import { type AllowEntry, formatAllowlist, matchEntry, parseAllowlist } from "@/lib/ingest/allowlist";
import { createSharedKeyAction, revokeSharedKeyAction, updateAllowlistAction } from "./actions";

export interface SharedKeyItem {
  id: string;
  name: string;
  prefix: string;
  splitByIp: boolean;
  projects: number;
  lastUsed: string;
  lastUsedIp: string;
  allowedIps: AllowEntry[];
}

/** A report without a key from an address on no allowlist. */
export interface RefusedItem {
  ip: string;
  project: string;
  /** "no key", or "unknown key obss_abcd…". */
  reason: string;
  count: number;
  when: string;
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
                {pending && <CircleNotchIcon className="animate-spin" />}
                Create shared key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SharedKeyList({
  keys,
  refused,
  appUrl,
}: {
  keys: SharedKeyItem[];
  refused: RefusedItem[];
  appUrl: string;
}) {
  const [revoking, setRevoking] = useState<SharedKeyItem | null>(null);
  const [allowing, setAllowing] = useState<SharedKeyItem | null>(null);
  const [showing, setShowing] = useState<SharedKeyItem | null>(null);
  if (keys.length === 0) return null;
  return (
    <>
      <ul className="divide-y rounded-xl border">
        {keys.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <KeyIcon className="size-4 shrink-0 text-muted-foreground" />
            {/* On a phone the buttons go below the name instead of squeezing it. */}
            <div className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] sm:basis-0">
              <p className="truncate font-medium">
                {k.name}{" "}
                <span className="font-mono text-xs font-normal text-muted-foreground">{k.prefix}…</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {k.projects} project{k.projects === 1 ? "" : "s"} ·{" "}
                {k.splitByIp ? "one per server" : "one per name"} ·{" "}
                {k.lastUsed ? `last used ${k.lastUsed} from ${k.lastUsedIp}` : "never used"}
                {k.allowedIps.length > 0 &&
                  ` · ${k.allowedIps.length} allowed address${k.allowedIps.length === 1 ? "" : "es"}`}
              </p>
            </div>
            <div className="ml-7 flex items-center gap-2 sm:ml-0">
              <Button variant="outline" size="sm" onClick={() => setShowing(k)}>
                <BookOpenIcon /> Setup
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAllowing(k)}>
                <TreeStructureIcon /> IP allowlist
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Revoke ${k.name}`}
                onClick={() => setRevoking(k)}
              >
                <TrashIcon />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {refused.length > 0 && (
        <div className="mt-6 space-y-2">
          <h3 className="text-sm font-medium">Not recorded, last 7 days</h3>
          <ul className="divide-y rounded-xl border">
            {refused.map((r) => (
              <li key={r.ip} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5">
                <span className="font-mono text-[13px]">{r.ip}</span>
                <span className="text-xs text-muted-foreground">
                  {[r.project, r.reason, `${r.count}×`, r.when].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Reports from addresses on no allowlist, without a valid key. Unverified: anyone can send one, with
            any project name, so only allow an address you recognise as your own server. A wrong key from an
            allowed address is then ignored, with a warning in the build log.
          </p>
        </div>
      )}
      <Dialog open={showing !== null} onOpenChange={(o) => !o && setShowing(null)}>
        <DialogContent className="max-h-[90vh] grid-cols-1 overflow-y-auto sm:max-w-2xl">
          {showing && (
            <>
              <DialogHeader>
                <DialogTitle>Set up {showing.name}</DialogTitle>
                <DialogDescription>
                  The steps from when the key was created. Every app gets the same key and its own project
                  name.
                </DialogDescription>
              </DialogHeader>
              <KeyReveal apiKey={null} prefix={showing.prefix} appUrl={appUrl} shared />
              <DialogFooter>
                <Button onClick={() => setShowing(null)}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {allowing && (
        <AllowlistDialog
          key={allowing.id}
          item={allowing}
          refused={refused}
          appUrl={appUrl}
          onClose={() => setAllowing(null)}
        />
      )}
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

/**
 * Addresses that may report without a key, as this key. Suggests the address this key last
 * reported from and recent refusals, since the address a build really uses (the Docker
 * gateway, IPv4 or IPv6) is hard to guess.
 */
function AllowlistDialog({
  item,
  refused,
  appUrl,
  onClose,
}: {
  item: SharedKeyItem;
  refused: RefusedItem[];
  appUrl: string;
  onClose: () => void;
}) {
  const [text, setText] = useState(formatAllowlist(item.allowedIps));
  const [saved, setSaved] = useState(item.allowedIps);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Checked while typing, so a mistake shows before saving; overlaps are checked on save.
  const parsed = parseAllowlist(text);
  const current = parsed.entries.map((e) => e.cidr);
  const problems = parsed.errors.length ? parsed.errors.join("\n") : error;
  const suggestions = [
    ...(item.lastUsedIp && item.lastUsedIp !== "unknown"
      ? [
          {
            ip: item.lastUsedIp,
            note: "last report with this key",
            detail: `last report with this key, ${item.lastUsed}`,
          },
        ]
      : []),
    ...refused.map((r) => ({
      ip: r.ip,
      note: r.project,
      detail: ["unverified", r.project, r.reason, `${r.count}×`, r.when].filter(Boolean).join(" · "),
    })),
  ].filter((s, i, all) => !matchEntry(s.ip, current) && all.findIndex((o) => o.ip === s.ip) === i);
  const add = (ip: string, note: string) =>
    setText((t) => `${t.trim() ? `${t.trimEnd()}\n` : ""}${ip}${note ? `  # ${note}` : ""}`);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] grid-cols-1 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>IP allowlist for {item.name}</DialogTitle>
          <DialogDescription>
            Builds from these addresses may report without a key. They count as this key: the same projects,
            created the same way{item.splitByIp ? ", one per server" : ""}.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const res = await updateAllowlistAction(item.id, text);
              if (res.error) setError(res.error);
              else {
                setSaved(res.entries ?? []);
                setText(formatAllowlist(res.entries ?? []));
                toast.success("Allowlist saved");
              }
            });
          }}
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={"198.51.100.4  # coolify-1\n2a01:4f8:c0c::/48  # coolify-2, IPv6"}
            className="font-mono text-[12.5px]"
            spellCheck={false}
            aria-label="Allowed addresses"
          />
          <p className="text-xs text-muted-foreground">
            One address or range per line; # starts a note. Observator sees the address as described under
            &ldquo;Client addresses&rdquo; in the README, so behind Cloudflare it is your server&rsquo;s own
            address. A build on the same server as Observator may arrive from the Docker gateway instead.
          </p>
          {problems && (
            <p role="alert" className="text-sm whitespace-pre-line text-destructive">
              {problems}
            </p>
          )}
          {suggestions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Seen by Observator</p>
              <p className="text-xs text-muted-foreground">
                Refused reports are unverified: check that an address is one of your servers before you add
                it.
              </p>
              <ul className="divide-y rounded-lg border">
                {suggestions.map((s) => (
                  <li key={s.ip} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[13px]">{s.ip}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.detail}</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => add(s.ip, s.note)}>
                      <PlusIcon /> Add
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Not a DialogFooter: the snippet follows below, so this is not the end of the dialog. */}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || parsed.errors.length > 0}>
              {pending && <CircleNotchIcon className="animate-spin" />}
              Save allowlist
            </Button>
          </div>
        </form>
        {saved.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Dockerfile for these servers</p>
            <p className="text-sm text-muted-foreground">
              The snippet without the key check: it reports without{" "}
              <code className="font-mono">OBSERVATOR_KEY</code>, and still uses a key when one is set (CI,
              other servers). Builds elsewhere send their report too and get &ldquo;not recorded&rdquo;.
            </p>
            <DockerfileSetup url={appUrl} keyless />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
