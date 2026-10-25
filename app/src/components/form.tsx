// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useFormStatus } from "react-dom";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/forms";
import { cn } from "@/lib/utils";

export function SubmitButton({ children, className, ...props }: React.ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} className={className} {...props}>
      {pending && <Loader2Icon className="animate-spin" />}
      {children}
    </Button>
  );
}

export function FormMessage({ state, className }: { state: FormState; className?: string }) {
  if (state.error) {
    return (
      <p role="alert" className={cn("text-sm text-destructive", className)}>
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{state.message}</p>;
  }
  return null;
}

export function TextField({
  label,
  name,
  state,
  description,
  className,
  ...props
}: React.ComponentProps<"input"> & {
  label: string;
  name: string;
  state?: FormState;
  description?: React.ReactNode;
}) {
  const error = state?.fieldErrors?.[name];
  const id = props.id ?? `field-${name}`;
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        defaultValue={props.type === "password" ? undefined : state?.values?.[name]}
        {...props}
      />
      {description && !error && <FieldDescription>{description}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}
