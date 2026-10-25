// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { qrSvg } from "@/lib/auth/qr";
import { newTotpSecret, otpauthUri } from "@/lib/auth/totp";
import { getPending, twoFactorStatus } from "@/lib/auth/two-factor";
import { cancelAction } from "./actions";
import { CodeForm, EnrollForm, PasskeyButton, RecoveryStep } from "./verify-forms";

export const metadata: Metadata = { title: "Two-step verification" };

function Cancel() {
  return (
    <form action={cancelAction} className="mt-4 text-center">
      <button className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        Sign in as someone else
      </button>
    </form>
  );
}

/**
 * The step between a correct password and a session. A password is never enough on its own:
 * an authenticator code, a recovery code or a passkey has to follow, and an account without
 * any of those sets up an authenticator here first.
 */
export default async function VerifyPage() {
  const pending = await getPending();
  if (!pending) redirect("/login?reason=expired");
  const status = await twoFactorStatus(pending.userId);

  if (pending.recoveryCodes) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Save your recovery codes</CardTitle>
          <CardDescription>Two-step verification is on for {pending.email}.</CardDescription>
        </CardHeader>
        <CardContent>
          <RecoveryStep codes={pending.recoveryCodes} />
        </CardContent>
      </Card>
    );
  }

  if (status.totp) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Two-step verification</CardTitle>
          <CardDescription>Enter the code from your authenticator app for {pending.email}.</CardDescription>
        </CardHeader>
        <CardContent>
          <CodeForm next={pending.next} hasPasskey={status.passkeys > 0} />
          <Cancel />
        </CardContent>
      </Card>
    );
  }

  // No way to enrol an authenticator from here: that would turn the password into the only factor.
  if (status.passkeys > 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Confirm it is you</CardTitle>
          <CardDescription>A password alone is not enough. Confirm with your passkey.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PasskeyButton next={pending.next} primary />
          <p className="text-center text-sm text-muted-foreground">
            Lost it? Another user can reset two-step verification for you under Settings, Users.
          </p>
          <Cancel />
        </CardContent>
      </Card>
    );
  }

  pending.enrollSecret ??= newTotpSecret();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up two-step verification</CardTitle>
        <CardDescription>
          Observator never signs you in with only a password. Link an authenticator app once; after that you
          can add a passkey and skip codes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EnrollForm
          qr={qrSvg(otpauthUri(pending.email, pending.enrollSecret))}
          secret={pending.enrollSecret}
          email={pending.email}
        />
        <Cancel />
      </CardContent>
    </Card>
  );
}
