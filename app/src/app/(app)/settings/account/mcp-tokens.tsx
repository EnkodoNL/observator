// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import { CircleNotchIcon, PlusIcon, RobotIcon, TrashIcon } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { CodeBlock } from "@/components/code-block";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { createMcpTokenAction, revokeMcpTokenAction } from "./actions";

export interface McpTokenItem {
  id: string;
  name: string;
  prefix: string;
  canWrite: boolean;
  created: string;
  lastUsed: string;
  lastUsedIp: string;
}

export function McpTokens({ tokens, endpoint }: { tokens: McpTokenItem[]; endpoint: string }) {
  const [revoking, setRevoking] = useState<McpTokenItem | null>(null);
  return (
    <div className="space-y-3">
      {tokens.length > 0 ? (
        <ul className="divide-y rounded-xl border">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <RobotIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {t.name}{" "}
                  <span className="font-mono text-xs font-normal text-muted-foreground">{t.prefix}…</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t.canWrite ? "reads and changes" : "reads only"} · created {t.created} ·{" "}
                  {t.lastUsed ? `last used ${t.lastUsed} from ${t.lastUsedIp}` : "never used"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Revoke ${t.name}`}
                onClick={() => setRevoking(t)}
              >
                <TrashIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No tokens yet.</p>
      )}
      <NewTokenDialog endpoint={endpoint} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Revoke ${revoking?.name ?? "token"}?`}
        description="Clients using it lose access immediately."
        confirmLabel="Revoke token"
        destructive
        onConfirm={async () => {
          if (!revoking) return;
          await revokeMcpTokenAction(revoking.id);
          toast.success("Token revoked");
        }}
      />
    </div>
  );
}

function NewTokenDialog({ endpoint }: { endpoint: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Claude Code");
  const [canWrite, setCanWrite] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setName("Claude Code");
    setCanWrite(true);
    setPassword("");
    setError(null);
    setToken(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <PlusIcon /> New MCP token
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] grid-cols-1 overflow-y-auto sm:max-w-2xl">
        {token ? (
          <>
            <DialogHeader>
              <DialogTitle>{name} is ready</DialogTitle>
              <DialogDescription>
                Copy it now: Observator only stores a hash and cannot show it again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <CodeBlock code={token} />
              <div className="space-y-2">
                <p className="text-sm font-medium">Add it to Claude Code</p>
                <CodeBlock
                  code={`claude mcp add --transport http observator ${endpoint} --header "Authorization: Bearer ${token}"`}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Or in a project&rsquo;s .mcp.json, with the token in an environment variable
                </p>
                <CodeBlock
                  label=".mcp.json"
                  code={JSON.stringify(
                    {
                      mcpServers: {
                        observator: {
                          type: "http",
                          url: endpoint,
                          headers: { Authorization: "Bearer ${OBSERVATOR_MCP_TOKEN}" },
                        },
                      },
                    },
                    null,
                    2,
                  )}
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                const res = await createMcpTokenAction({ name, canWrite, password });
                if (res.error) setError(res.error);
                else setToken(res.token ?? null);
              });
            }}
          >
            <DialogHeader className="mb-4">
              <DialogTitle>New MCP token</DialogTitle>
              <DialogDescription>
                For Claude Code and other MCP clients. A token acts as you without a second factor, so
                creating one asks for your password again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Field>
                <FieldLabel htmlFor="mcp-name">Name</FieldLabel>
                <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={canWrite}
                  onCheckedChange={(v) => setCanWrite(Boolean(v))}
                />
                <span>
                  <span className="font-medium">May make changes</span>
                  <span className="block text-muted-foreground">
                    Create and update projects, labels, ignores, shared keys, channels and settings, run
                    checks and redeploy. Never delete anything, and never touch users, tokens or sign-in.
                  </span>
                </span>
              </label>
              <Field>
                <FieldLabel htmlFor="mcp-password">Your password</FieldLabel>
                <Input
                  id="mcp-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending || !name.trim() || !password}>
                {pending && <CircleNotchIcon className="animate-spin" />}
                Create token
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
