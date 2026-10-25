// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { listPasskeys } from "@/lib/auth/passkeys";
import { requireUser } from "@/lib/auth/session";
import { twoFactorStatus } from "@/lib/auth/two-factor";
import { pbDate } from "@/lib/pb/admin";
import { formatDate, timeAgo } from "@/lib/time";
import { Passkeys } from "./passkeys";
import { PasswordForm } from "./password-form";
import { TwoFactor } from "./two-factor";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const { user } = await requireUser();
  const [passkeys, twoFactor] = await Promise.all([listPasskeys(user.id), twoFactorStatus(user.id)]);

  return (
    <div className="space-y-10">
      <section>
        <PageHeader title="Passkeys" description={`Sign in as ${user.email} without a password.`} />
        <Passkeys
          passkeys={passkeys.map((p) => ({
            id: p.id,
            name: p.name,
            synced: p.backedUp || p.deviceType === "multiDevice",
            created: formatDate(pbDate(p.created)),
            lastUsed: p.lastUsed ? timeAgo(pbDate(p.lastUsed)) : "",
          }))}
        />
      </section>
      <section>
        <PageHeader
          title="Two-step verification"
          description="A password alone never signs you in. A passkey does; with a password, a code from an authenticator app follows."
        />
        <TwoFactor
          enabled={twoFactor.totp}
          enabledAt={formatDate(pbDate(twoFactor.enabledAt))}
          recoveryLeft={twoFactor.recoveryLeft}
          passkeys={twoFactor.passkeys}
        />
      </section>
      <section>
        <PageHeader title="Password" description="Changing it signs out every other session." />
        <PasswordForm email={user.email} />
      </section>
    </div>
  );
}
