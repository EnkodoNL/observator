// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveProjectSettingsAction } from "./actions";

export function ProjectSettings({
  projectId,
  name,
  webhook,
}: {
  projectId: string;
  name: string;
  webhook: { masked: string; method: "GET" | "POST"; hasToken: boolean };
}) {
  const [value, setValue] = useState({
    name,
    deployWebhookUrl: "",
    deployWebhookMethod: webhook.method,
    deployWebhookToken: "",
    clearWebhook: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof value>(k: K, v: (typeof value)[K]) =>
    setValue((s) => ({ ...s, [k]: v }));

  return (
    <form
      className="max-w-xl"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveProjectSettingsAction(projectId, value);
          setErrors(res.fieldErrors ?? {});
          if (res.ok) {
            toast.success("Project saved");
            setValue((s) => ({ ...s, deployWebhookUrl: "", deployWebhookToken: "", clearWebhook: false }));
          } else toast.error(res.error ?? "Could not save");
        });
      }}
    >
      <FieldGroup>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="p-name">Name</FieldLabel>
          <Input id="p-name" value={value.name} onChange={(e) => set("name", e.target.value)} />
          {errors.name && <FieldError>{errors.name}</FieldError>}
        </Field>
        <Field data-invalid={errors.deployWebhookUrl ? true : undefined}>
          <FieldLabel htmlFor="p-webhook">Deploy webhook</FieldLabel>
          <Input
            id="p-webhook"
            type="url"
            autoComplete="off"
            placeholder={
              webhook.masked
                ? `${webhook.masked} (stored; leave empty to keep)`
                : "https://coolify.example.com/api/v1/deploy?uuid=…"
            }
            value={value.deployWebhookUrl}
            onChange={(e) => set("deployWebhookUrl", e.target.value)}
          />
          <FieldDescription>
            Adds a Redeploy button here and in notifications. Coolify: the deploy webhook URL from the
            resource, with an API token below and method GET. Dokploy and Portainer: the webhook URL, method
            POST, no token.
          </FieldDescription>
          {errors.deployWebhookUrl && <FieldError>{errors.deployWebhookUrl}</FieldError>}
        </Field>
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field>
            <FieldLabel htmlFor="p-method">Method</FieldLabel>
            <NativeSelect
              id="p-method"
              value={value.deployWebhookMethod}
              onChange={(e) => set("deployWebhookMethod", e.target.value as "GET" | "POST")}
            >
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="p-token">
              Bearer token <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input
              id="p-token"
              type="password"
              autoComplete="off"
              placeholder={webhook.hasToken ? "•••••••• (stored; leave empty to keep)" : ""}
              value={value.deployWebhookToken}
              onChange={(e) => set("deployWebhookToken", e.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" />}
            Save
          </Button>
          {webhook.masked && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await saveProjectSettingsAction(projectId, { ...value, clearWebhook: true });
                  if (res.ok) toast.success("Deploy webhook removed");
                })
              }
            >
              Remove deploy webhook
            </Button>
          )}
        </div>
      </FieldGroup>
    </form>
  );
}
