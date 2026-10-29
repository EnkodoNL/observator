// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import {
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addDomainAction,
  checkDomainAction,
  removeDomainAction,
  removeHostAction,
  setHostProjectAction,
  updateDomainAction,
} from "./actions";

export interface ProjectOption {
  id: string;
  name: string;
}

function ProjectSelect({
  projects,
  value,
  onChange,
  id,
  disabled,
}: {
  projects: ProjectOption[];
  value: string;
  onChange: (v: string) => void;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <NativeSelect id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">No project</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </NativeSelect>
  );
}

/** A name to watch: a subdomain checks its certificate and its registered domain's registration. */
export function AddDomainForm({ projects, project = "" }: { projects: ProjectOption[]; project?: string }) {
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState(project);
  const [checkCert, setCheckCert] = useState(true);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await addDomainAction({ name, project: projectId, checkCert });
          if (res.error) toast.error(res.error);
          else {
            toast.success(`Watching ${name.trim()}`);
            setName("");
          }
        });
      }}
    >
      <Field className="min-w-56 flex-1">
        <FieldLabel htmlFor="domain-name">Domain or hostname</FieldLabel>
        <Input
          id="domain-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="enkodo.dev or app.enkodo.dev"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </Field>
      <Field className="w-48">
        <FieldLabel htmlFor="domain-project">Project</FieldLabel>
        <ProjectSelect id="domain-project" projects={projects} value={projectId} onChange={setProjectId} />
      </Field>
      <Field orientation="horizontal" className="w-auto pb-1.5">
        <Checkbox id="domain-cert" checked={checkCert} onCheckedChange={(v) => setCheckCert(Boolean(v))} />
        <FieldLabel htmlFor="domain-cert" className="font-normal">
          Check its certificate
        </FieldLabel>
      </Field>
      <Button type="submit" disabled={pending || !name.trim()}>
        {pending ? <CircleNotchIcon className="animate-spin" /> : <PlusIcon />} Watch
      </Button>
    </form>
  );
}

export interface DomainSettings {
  id: string;
  name: string;
  note: string;
  remindDays: number;
  manualExpiresAt: string;
}

/** Edit (reminder, note, date by hand), check now, and stop watching. */
export function DomainActions({ domain }: { domain: DomainSettings }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
        <PencilSimpleIcon /> Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await checkDomainAction(domain.id);
            if (res.error) toast.error(res.error);
          })
        }
      >
        {pending ? <CircleNotchIcon className="animate-spin" /> : <ArrowsClockwiseIcon />} Check
      </Button>
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="icon-sm" aria-label={`Stop watching ${domain.name}`}>
            <TrashIcon />
          </Button>
        }
        title={`Stop watching ${domain.name}?`}
        description="Its registration and every host under it are no longer checked. Hosts from builds or Coolify come back with their next report."
        confirmLabel="Stop watching"
        destructive
        onConfirm={async () => {
          const res = await removeDomainAction(domain.id);
          if (res.error) toast.error(res.error);
        }}
      />
      {editing && <EditDomainDialog domain={domain} onClose={() => setEditing(false)} />}
    </span>
  );
}

function EditDomainDialog({ domain, onClose }: { domain: DomainSettings; onClose: () => void }) {
  const [note, setNote] = useState(domain.note);
  const [remindDays, setRemindDays] = useState(domain.remindDays ? String(domain.remindDays) : "");
  const [date, setDate] = useState(domain.manualExpiresAt.slice(0, 10));
  const [pending, start] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{domain.name}</DialogTitle>
          <DialogDescription>For the registration of this domain; its hosts follow.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await updateDomainAction(domain.id, {
                note,
                remindDays: remindDays || "0",
                manualExpiresAt: date,
              });
              if (res.error) toast.error(res.error);
              else onClose();
            });
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="domain-remind">Remind me</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="domain-remind"
                  type="number"
                  min={0}
                  max={3650}
                  className="w-24"
                  value={remindDays}
                  onChange={(e) => setRemindDays(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">days before it expires</span>
              </div>
              <FieldDescription>
                Earlier than the usual warning, for something to do in time: moving it to another registrar
                before it renews, say.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="domain-note">Note</FieldLabel>
              <Textarea
                id="domain-note"
                rows={2}
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Move to registrar X before it renews"
              />
              <FieldDescription>Shown with every reminder and warning.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="domain-date">Expires on</FieldLabel>
              <Input
                id="domain-date"
                type="date"
                className="w-44"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <FieldDescription>
                For registries that publish no date (.nl, .de, .eu): the date from your registrar. It wins
                over the registry&rsquo;s.
              </FieldDescription>
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <CircleNotchIcon className="animate-spin" />}
                Save
              </Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A host's project, and stop watching it. */
export function HostActions({
  host,
  projects,
}: {
  host: { id: string; name: string; project: string };
  projects: ProjectOption[];
}) {
  const [pending, start] = useTransition();
  return (
    <span className="flex shrink-0 items-center gap-1">
      <ProjectSelect
        projects={projects}
        value={host.project}
        disabled={pending}
        onChange={(v) =>
          start(async () => {
            const res = await setHostProjectAction(host.id, v);
            if (res.error) toast.error(res.error);
          })
        }
      />
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="icon-sm" aria-label={`Stop watching ${host.name}`}>
            <TrashIcon />
          </Button>
        }
        title={`Stop watching ${host.name}?`}
        description="Its certificate is no longer checked. A host from a build or Coolify comes back with its next report."
        confirmLabel="Stop watching"
        destructive
        onConfirm={async () => {
          const res = await removeHostAction(host.id);
          if (res.error) toast.error(res.error);
        }}
      />
    </span>
  );
}
