// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { acceptInviteAction } from "./actions";

export function InviteForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState(acceptInviteAction, { values: { email } });
  return (
    <Card>
      <CardHeader>
        <CardTitle>You have been invited</CardTitle>
        <CardDescription>Create your account. You can add a passkey afterwards.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action}>
          <input type="hidden" name="token" value={token} />
          <FieldGroup>
            <TextField
              label="E-mail"
              name="email"
              type="email"
              autoComplete="username"
              required
              state={state}
            />
            <TextField
              label="Password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              state={state}
              description="At least 10 characters."
            />
            <TextField
              label="Confirm password"
              name="passwordConfirm"
              type="password"
              autoComplete="new-password"
              required
              state={state}
            />
            <FormMessage state={state} />
            <SubmitButton className="w-full">Create account</SubmitButton>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
