// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { loginAction } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(loginAction, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back.</CardDescription>
      </CardHeader>
      <CardContent>
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
            <SubmitButton className="w-full">Sign in</SubmitButton>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
