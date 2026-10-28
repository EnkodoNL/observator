// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleNotchIcon, FingerprintIcon } from "@phosphor-icons/react/ssr";
import { CodeBlock } from "@/components/code-block";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { passkeyError, signInWithPasskey } from "@/lib/auth/passkey-client";
import { enrollAction, finishEnrollAction, verifyCodeAction } from "./actions";

export function PasskeyButton({ next, primary }: { next: string; primary?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        size={primary ? "lg" : "default"}
        variant={primary ? "default" : "outline"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          try {
            await signInWithPasskey();
            router.replace(next);
            router.refresh();
          } catch (err) {
            setMessage(passkeyError(err));
            setBusy(false);
          }
        }}
      >
        {busy ? <CircleNotchIcon className="animate-spin" /> : <FingerprintIcon />}
        {primary ? "Confirm with your passkey" : "Use your passkey instead"}
      </Button>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

export function CodeForm({ next, hasPasskey }: { next: string; hasPasskey: boolean }) {
  const [state, action] = useActionState(verifyCodeAction, {});
  const [recovery, setRecovery] = useState(false);
  return (
    <FieldGroup>
      <form action={action}>
        <FieldGroup>
          <TextField
            key={recovery ? "recovery" : "totp"}
            label={recovery ? "Recovery code" : "Code from your authenticator app"}
            name="code"
            autoComplete="one-time-code"
            inputMode={recovery ? "text" : "numeric"}
            pattern={recovery ? undefined : "[0-9 ]{6,7}"}
            maxLength={recovery ? 20 : 7}
            placeholder={recovery ? "xxxx-xxxx-xxxx" : "123 456"}
            autoFocus
            required
            spellCheck={false}
            className="[&_input]:font-mono [&_input]:tracking-widest"
          />
          <FormMessage state={state} />
          <SubmitButton className="w-full">Verify</SubmitButton>
          <button
            type="button"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => setRecovery((r) => !r)}
          >
            {recovery ? "Use the authenticator app" : "Lost your phone? Use a recovery code"}
          </button>
        </FieldGroup>
      </form>
      {hasPasskey && (
        <>
          <FieldSeparator>or</FieldSeparator>
          <PasskeyButton next={next} />
        </>
      )}
    </FieldGroup>
  );
}

/** Server-rendered from the pending sign-in, so a reload shows the codes again. */
export function RecoveryStep({ codes }: { codes: string[] }) {
  return (
    <form action={finishEnrollAction}>
      <FieldGroup>
        <p className="text-sm text-muted-foreground">
          Each one signs you in once if you lose your phone. Keep them in your password manager; after this
          step they are not shown again.
        </p>
        <CodeBlock code={codes.join("\n")} label="Recovery codes" />
        <SubmitButton className="w-full">I saved them, continue</SubmitButton>
      </FieldGroup>
    </form>
  );
}

export function EnrollForm({ qr, secret, email }: { qr: string; secret: string; email: string }) {
  const [state, action] = useActionState(enrollAction, {});

  return (
    <form action={action}>
      <FieldGroup>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Open an authenticator app (1Password, Bitwarden, Google Authenticator, Aegis, ...).</li>
          <li>Scan the code, or enter the key by hand.</li>
          <li>Type the 6-digit code the app shows.</li>
        </ol>
        <div
          className="mx-auto w-44 overflow-hidden rounded-lg border bg-white p-2"
          dangerouslySetInnerHTML={{ __html: qr }}
        />
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Key for {email}</p>
          <CodeBlock code={secret.replace(/(.{4})/g, "$1 ").trim()} className="[&_code]:whitespace-normal" />
        </div>
        <TextField
          label="Code from the app"
          name="code"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="123 456"
          required
          className="[&_input]:font-mono [&_input]:tracking-widest"
          state={state}
        />
        <FormMessage state={state} />
        <SubmitButton className="w-full">Turn on and continue</SubmitButton>
      </FieldGroup>
    </form>
  );
}
