// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import { CircleNotchIcon, ShieldCheckIcon, ShieldIcon } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { CodeBlock } from "@/components/code-block";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  beginTotpSetupAction,
  confirmTotpSetupAction,
  disableTotpAction,
  regenerateRecoveryAction,
} from "./actions";

type Mode = "setup" | "recovery" | "disable" | null;

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Each code signs you in once if you lose your phone. Store them in your password manager; they are not
        shown again.
      </p>
      <CodeBlock code={codes.join("\n")} label="Recovery codes" />
    </div>
  );
}

export function TwoFactor({
  enabled,
  enabledAt,
  recoveryLeft,
  passkeys,
}: {
  enabled: boolean;
  enabledAt: string;
  recoveryLeft: number;
  passkeys: number;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = (m: Mode) => {
    setMode(m);
    setCode("");
    setCodes(null);
    setError(null);
    if (m === "setup") start(async () => setSetup(await beginTotpSetupAction()));
  };

  const submit = () =>
    start(async () => {
      setError(null);
      if (mode === "setup" && setup) {
        const res = await confirmTotpSetupAction(setup.secret, code);
        if (res.error) setError(res.error);
        else setCodes(res.codes ?? []);
      } else if (mode === "recovery") {
        const res = await regenerateRecoveryAction(code);
        if (res.error) setError(res.error);
        else setCodes(res.codes ?? []);
      } else if (mode === "disable") {
        const res = await disableTotpAction(code);
        if (res.error) setError(res.error);
        else {
          toast.success("Authenticator app turned off");
          setMode(null);
        }
      }
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
        {enabled ? (
          <ShieldCheckIcon className="size-5 text-ok" />
        ) : (
          <ShieldIcon className="size-5 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">Authenticator app {enabled ? "on" : "off"}</p>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? `Since ${enabledAt} · ${recoveryLeft} recovery code${recoveryLeft === 1 ? "" : "s"} left` +
                (passkeys > 0 ? "" : " · add a passkey to be able to turn it off")
              : passkeys > 0
                ? "Password sign-ins are confirmed with your passkey."
                : "Your next password sign-in will ask you to set it up."}
          </p>
        </div>
        {enabled ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => open("recovery")}>
              New recovery codes
            </Button>
            {passkeys > 0 && (
              <Button variant="ghost" size="sm" onClick={() => open("disable")}>
                Turn off
              </Button>
            )}
          </div>
        ) : (
          <Button size="sm" onClick={() => open("setup")}>
            Set up
          </Button>
        )}
      </div>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="grid-cols-1 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === "setup"
                ? "Set up an authenticator app"
                : mode === "recovery"
                  ? "New recovery codes"
                  : "Turn off the authenticator app"}
            </DialogTitle>
            <DialogDescription>
              {mode === "setup"
                ? "Scan the code with your authenticator app, then enter the code it shows."
                : mode === "recovery"
                  ? "Your old recovery codes stop working. Confirm with a current code."
                  : "Password sign-ins will then be confirmed with your passkey. Confirm with a current code."}
            </DialogDescription>
          </DialogHeader>

          {codes ? (
            <RecoveryCodes codes={codes} />
          ) : (
            <form
              id="two-factor-form"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {mode === "setup" && (
                <div className="space-y-2">
                  {setup ? (
                    <>
                      <div
                        className="mx-auto w-44 overflow-hidden rounded-lg border bg-white p-2"
                        dangerouslySetInnerHTML={{ __html: setup.qr }}
                      />
                      <CodeBlock
                        code={setup.secret.replace(/(.{4})/g, "$1 ").trim()}
                        className="[&_code]:whitespace-normal"
                      />
                    </>
                  ) : (
                    <CircleNotchIcon className="mx-auto animate-spin text-muted-foreground" />
                  )}
                </div>
              )}
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="tf-code">
                  {mode === "setup" ? "Code from the app" : "Current code or recovery code"}
                </FieldLabel>
                <Input
                  id="tf-code"
                  value={code}
                  autoComplete="one-time-code"
                  className="font-mono tracking-widest"
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
              </Field>
            </form>
          )}

          <DialogFooter>
            {codes ? (
              <Button onClick={() => setMode(null)}>Done</Button>
            ) : (
              <Button
                type="submit"
                form="two-factor-form"
                variant={mode === "disable" ? "destructive" : "default"}
                disabled={pending || !code.trim() || (mode === "setup" && !setup)}
              >
                {pending && <CircleNotchIcon className="animate-spin" />}
                {mode === "setup" ? "Turn on" : mode === "recovery" ? "Create new codes" : "Turn off"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
