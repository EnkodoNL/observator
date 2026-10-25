// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import { KeyRoundIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/session";
import { INVITE_TTL_DAYS, listInvites, listUsers } from "@/lib/data/users";
import { pbDate } from "@/lib/pb/admin";
import { formatDate, timeAgo } from "@/lib/time";
import { InviteButton, RemoveUserButton, RevokeInviteButton } from "./users-client";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const { user: me } = await requireUser();
  const [users, invites] = await Promise.all([listUsers(), listInvites()]);

  return (
    <div className="space-y-10">
      <section>
        <PageHeader
          title="Users"
          description="People who can sign in to this Observator."
          actions={<InviteButton days={INVITE_TTL_DAYS} />}
        />
        <ul className="divide-y rounded-xl border">
          {users.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {u.email}
                  {u.id === me.id && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">you</span>
                  )}
                </p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  Joined {formatDate(pbDate(u.created))}
                  {u.passkeys > 0 && (
                    <>
                      {" · "}
                      <KeyRoundIcon className="size-3" /> {u.passkeys} passkey{u.passkeys === 1 ? "" : "s"}
                    </>
                  )}
                </p>
              </div>
              {u.id !== me.id && users.length > 1 && <RemoveUserButton id={u.id} email={u.email} />}
            </li>
          ))}
        </ul>
      </section>

      {invites.length > 0 && (
        <section>
          <PageHeader title="Open invites" description="Links that have not been used yet." />
          <ul className="divide-y rounded-xl border">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{i.email || "Anyone with the link"}</p>
                  <p className="text-xs text-muted-foreground">
                    Created {timeAgo(pbDate(i.created))} · expires {formatDate(pbDate(i.expiresAt))}
                  </p>
                </div>
                <RevokeInviteButton id={i.id} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
