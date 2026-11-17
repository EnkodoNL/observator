// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CoolifyServerView } from "@/lib/coolify/servers";
import { timeAgo } from "@/lib/time";
import { deleteServerAction, saveServerAction, testServerAction } from "./actions";

type Server = CoolifyServerView & {
  projects: number;
  /** The last sync of its databases and services. */
  synced: { at: string; databases: number | null; services: number | null; error: string | null } | null;
};

/** "8 databases and 18 services, synced 5 min. ago", or why not. */
function syncLine(synced: Server["synced"]): string {
  if (!synced) return "Databases and services: not synced yet.";
  const n = (count: number | null, one: string, many: string) =>
    count === null ? `${many}: not readable` : `${count} ${count === 1 ? one : many}`;
  return `${n(synced.databases, "database", "databases")} and ${n(synced.services, "service", "services")}, synced ${timeAgo(new Date(synced.at))}.`;
}

function ServerForm({ server, onDone }: { server?: Server; onDone?: () => void }) {
  const [value, setValue] = useState({
    id: server?.id,
    name: server?.name ?? "",
    url: server?.url ?? "",
    token: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: "name" | "url" | "token", v: string) => setValue((s) => ({ ...s, [k]: v }));
  const prefix = server?.id ?? "new";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveServerAction(value);
          setErrors(res.fieldErrors ?? {});
          if (res.ok) {
            toast.success(`${value.name} saved`);
            setValue((s) => ({ ...s, token: "" }));
            onDone?.();
          } else if (res.error) toast.error(res.error);
        });
      }}
    >
      <FieldGroup>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor={`${prefix}-name`}>Name</FieldLabel>
          <Input id={`${prefix}-name`} value={value.name} onChange={(e) => set("name", e.target.value)} />
          {errors.name && <FieldError>{errors.name}</FieldError>}
        </Field>
        <Field data-invalid={errors.url ? true : undefined}>
          <FieldLabel htmlFor={`${prefix}-url`}>URL</FieldLabel>
          <Input
            id={`${prefix}-url`}
            placeholder="https://coolify.example.com"
            value={value.url}
            onChange={(e) => set("url", e.target.value)}
          />
          {errors.url && <FieldError>{errors.url}</FieldError>}
        </Field>
        <Field data-invalid={errors.token ? true : undefined}>
          <FieldLabel htmlFor={`${prefix}-token`}>API token</FieldLabel>
          <Input
            id={`${prefix}-token`}
            type="password"
            autoComplete="off"
            placeholder={server?.hasToken ? "Stored; leave empty to keep it" : ""}
            value={value.token}
            onChange={(e) => set("token", e.target.value)}
          />
          <FieldDescription>Stored encrypted. Read and deploy permissions.</FieldDescription>
          {errors.token && <FieldError>{errors.token}</FieldError>}
        </Field>
      </FieldGroup>
      {result && <p className={result.ok ? "text-sm text-ok" : "text-sm text-warn"}>{result.message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <CircleNotchIcon className="animate-spin" />}
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => start(async () => setResult(await testServerAction(value)))}
        >
          Test
        </Button>
      </div>
    </form>
  );
}

export function CoolifyServers({ servers, canStore }: { servers: Server[]; canStore: boolean }) {
  const [adding, setAdding] = useState(servers.length === 0);
  if (!canStore)
    return (
      <p className="text-sm text-warn">
        Set SECRETS_KEY first: the API token is stored encrypted with it (openssl rand -base64 32).
      </p>
    );
  return (
    <div className="max-w-2xl space-y-8">
      {servers.map((s) => (
        <div key={s.id} className="space-y-3 border-b pb-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">{s.name}</h3>
            <span className="text-sm text-muted-foreground">
              {s.projects === 1 ? "1 linked project" : `${s.projects} linked projects`}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {syncLine(s.synced)}
            {s.synced?.error && <span className="text-warn"> {s.synced.error}</span>}
          </p>
          <ServerForm server={s} />
          <ConfirmDialog
            trigger={
              <Button variant="ghost" className="text-danger">
                Remove server
              </Button>
            }
            title={`Remove ${s.name}?`}
            description="Linked projects keep their application but lose the connection until a server has it again. Deploy checks, domains from Coolify and redeploys over the API stop for them."
            confirmLabel="Remove"
            destructive
            onConfirm={async () => {
              await deleteServerAction(s.id);
              toast.success(`${s.name} removed`);
            }}
          />
        </div>
      ))}
      {adding ? (
        <div className="space-y-3">
          <h3 className="font-medium">Add a Coolify server</h3>
          <ServerForm onDone={() => setAdding(servers.length === 0)} />
        </div>
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)}>
          Add a Coolify server
        </Button>
      )}
    </div>
  );
}
