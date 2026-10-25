// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useActionState } from "react";
import { FieldGroup } from "@/components/ui/field";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { changePasswordAction } from "./actions";

export function PasswordForm({ email }: { email: string }) {
  const [state, action] = useActionState(changePasswordAction, {});
  return (
    <form action={action} className="max-w-sm">
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
      <FieldGroup>
        <TextField
          label="Current password"
          name="current"
          type="password"
          autoComplete="current-password"
          required
          state={state}
        />
        <TextField
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          state={state}
        />
        <TextField
          label="Confirm new password"
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          required
          state={state}
        />
        <FormMessage state={state} />
        <div>
          <SubmitButton variant="outline">Change password</SubmitButton>
        </div>
      </FieldGroup>
    </form>
  );
}
