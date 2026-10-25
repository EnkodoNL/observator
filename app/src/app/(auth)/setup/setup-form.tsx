// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { setupAction } from "../actions";

export function SetupForm() {
  const [state, action] = useActionState(setupAction, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>This page only works once. After this, sign-up is closed.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action}>
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
              description="At least 10 characters. You can add a passkey later."
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
