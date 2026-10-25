// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findInvite } from "@/lib/data/users";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Invite" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invite = await findInvite(token);
  if (!invite) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invite not valid</CardTitle>
          <CardDescription>
            This link was already used, has expired, or was revoked. Ask for a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="text-sm underline-offset-4 hover:underline">
            Go to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }
  return <InviteForm token={token} email={invite.email} />;
}
