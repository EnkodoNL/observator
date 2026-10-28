// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { signOutEverywhereAction } from "./actions";

export function SignOutEverywhere() {
  return (
    <ConfirmDialog
      trigger={<Button variant="outline">Sign out everywhere</Button>}
      title="Sign out everywhere?"
      description="Every browser signed in as you is signed out, this one too. MCP tokens keep working; revoke those separately."
      confirmLabel="Sign out everywhere"
      onConfirm={() => signOutEverywhereAction()}
    />
  );
}
