// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useActionState, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from "@simplewebauthn/browser";
import { CircleNotchIcon, FingerprintIcon } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { passkeyError, signInWithPasskey } from "@/lib/auth/passkey-client";
import { loginAction } from "../actions";

const noopSubscribe = () => () => {};

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action] = useActionState(loginAction, notice ? { error: notice } : {});
  const router = useRouter();
  // false during SSR, the real answer in the browser, without a setState in an effect.
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => browserSupportsWebAuthn(),
    () => false,
  );
  const [busy, setBusy] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState<string | null>(null);

  const done = () => {
    router.replace(next);
    router.refresh();
  };

  useEffect(() => {
    if (!browserSupportsWebAuthn()) return;
    // Offer passkeys in the e-mail field's autofill list as well.
    void browserSupportsWebAuthnAutofill().then((ok) => {
      if (!ok) return;
      signInWithPasskey({ autofill: true })
        .then(done)
        .catch((err) => {
          const message = passkeyError(err);
          if (message) setPasskeyMessage(message);
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {supported && (
            <>
              <Button
                size="lg"
                className="w-full"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setPasskeyMessage(null);
                  try {
                    await signInWithPasskey();
                    done();
                  } catch (err) {
                    setPasskeyMessage(passkeyError(err));
                    setBusy(false);
                  }
                }}
              >
                {busy ? <CircleNotchIcon className="animate-spin" /> : <FingerprintIcon />}
                Sign in with passkey
              </Button>
              {passkeyMessage && (
                <p role="alert" className="text-sm text-destructive">
                  {passkeyMessage}
                </p>
              )}
              <FieldSeparator>or with your password</FieldSeparator>
            </>
          )}
          <form action={action}>
            <input type="hidden" name="next" value={next} />
            <FieldGroup>
              <TextField
                label="E-mail"
                name="email"
                type="email"
                autoComplete="username webauthn"
                required
                state={state}
              />
              <TextField
                label="Password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                state={state}
              />
              <FormMessage state={state} />
              <SubmitButton variant={supported ? "outline" : "default"} className="w-full">
                Sign in
              </SubmitButton>
            </FieldGroup>
          </form>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
