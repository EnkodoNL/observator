// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import { ChevronLeftIcon, Loader2Icon, RadarIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ChannelView } from "@/lib/data/channels";
import { EVENT_LABEL, EVENT_TYPES, type EventType } from "@/lib/issues/events";
import type { ChannelMeta } from "@/lib/notify/channels/types";
import type { ChannelType, Severity } from "@/lib/pb/types";
import { cn } from "@/lib/utils";
import { detectTelegramAction, saveChannelAction, testChannelAction, type ChannelInput } from "./actions";

const SEVERITY_OPTIONS: { value: Severity; label: string }[] = [
  { value: "unknown", label: "All advisories" },
  { value: "low", label: "Low and above" },
  { value: "moderate", label: "Moderate and above" },
  { value: "high", label: "High and above" },
  { value: "critical", label: "Critical only" },
];

const EVENT_HINT: Record<EventType, string> = {
  "node.security_update": "A project runs a Node version with a newer security release",
  "node.eol": "A project's Node line is end-of-life, or will be within 30 days",
  "vuln.new": "New advisories in a project's packages",
  "vuln.resolved": "A reported advisory is gone after a new build",
  "project.stale": "A project has not reported for a while",
  "digest.weekly": "Summary of everything, once a week",
};

interface Props {
  metas: ChannelMeta[];
  projects: { id: string; name: string }[];
  channel?: ChannelView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChannelDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-1 overflow-y-auto sm:max-w-xl">
        {props.open && <ChannelForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function ChannelForm({ metas, projects, channel, onOpenChange }: Props) {
  const [type, setType] = useState<ChannelType | null>(channel?.type ?? null);
  const meta = metas.find((m) => m.type === type);
  if (!type || !meta) return <TypePicker metas={metas} onPick={setType} />;
  return (
    <ChannelFields
      key={type}
      meta={meta}
      projects={projects}
      channel={channel}
      onBack={channel ? undefined : () => setType(null)}
      onDone={() => onOpenChange(false)}
    />
  );
}

function TypePicker({ metas, onPick }: { metas: ChannelMeta[]; onPick: (t: ChannelType) => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a channel</DialogTitle>
        <DialogDescription>Where should Observator tell you when something needs doing?</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2 sm:grid-cols-2">
        {metas.map((m) => (
          <button
            key={m.type}
            type="button"
            onClick={() => onPick(m.type)}
            className="rounded-lg border p-3 text-left transition-colors outline-none hover:border-foreground/30 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="block text-sm font-medium">{m.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{m.description}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function ChannelFields({
  meta,
  projects,
  channel,
  onBack,
  onDone,
}: {
  meta: ChannelMeta;
  projects: { id: string; name: string }[];
  channel?: ChannelView;
  onBack?: () => void;
  onDone: () => void;
}) {
  const [input, setInput] = useState<ChannelInput>({
    id: channel?.id,
    type: meta.type,
    name: channel?.name ?? meta.label,
    enabled: channel?.enabled ?? true,
    minSeverity: channel?.minSeverity ?? "unknown",
    events: channel?.events ?? [...EVENT_TYPES],
    projects: channel?.projects ?? [],
    config: {
      ...(meta.type === "ntfy" && !channel ? { serverUrl: "https://ntfy.sh" } : {}),
      ...channel?.config,
    },
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [chats, setChats] = useState<{ id: string; name: string; type: string }[] | null>(null);
  const [detecting, startDetect] = useTransition();
  const [scoped, setScoped] = useState((channel?.projects.length ?? 0) > 0);

  const setConfig = (name: string, value: string) =>
    setInput((s) => ({ ...s, config: { ...s.config, [name]: value } }));
  const toggle = <T,>(list: T[], value: T, on: boolean) =>
    on ? [...new Set([...list, value])] : list.filter((v) => v !== value);
  const payload = (): ChannelInput => ({ ...input, projects: scoped ? input.projects : [] });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startSave(async () => {
          const res = await saveChannelAction(payload());
          setErrors(res.fieldErrors ?? {});
          if (res.ok) {
            toast.success(channel ? "Channel saved" : "Channel added");
            onDone();
          } else toast.error(res.error ?? "Could not save");
        });
      }}
    >
      <DialogHeader className="mb-4">
        <DialogTitle className="flex items-center gap-1">
          {onBack && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onBack}
              aria-label="Back to channel types"
            >
              <ChevronLeftIcon />
            </Button>
          )}
          {channel ? `Edit ${channel.name}` : `Add ${meta.label}`}
        </DialogTitle>
        <DialogDescription>{meta.description}</DialogDescription>
      </DialogHeader>

      <FieldGroup>
        {meta.help && (
          <ol className="list-decimal space-y-1 rounded-lg bg-muted/50 py-3 pr-3 pl-8 text-sm text-muted-foreground">
            {meta.help.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ol>
        )}

        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="ch-name">Name</FieldLabel>
          <Input
            id="ch-name"
            value={input.name}
            onChange={(e) => setInput((s) => ({ ...s, name: e.target.value }))}
          />
          {errors.name && <FieldError>{errors.name}</FieldError>}
        </Field>

        {meta.fields.map((f) => {
          const err = errors[`config.${f.name}`];
          const stored = channel?.secretsSet.includes(f.name);
          return (
            <Field key={f.name} data-invalid={err ? true : undefined}>
              <FieldLabel htmlFor={`ch-${f.name}`}>
                {f.label}
                {!f.required && <span className="font-normal text-muted-foreground">(optional)</span>}
              </FieldLabel>
              <div className="flex gap-2">
                <Input
                  id={`ch-${f.name}`}
                  type={f.kind === "password" ? "password" : f.kind === "url" ? "url" : "text"}
                  autoComplete="off"
                  placeholder={stored ? "•••••••• (stored; leave empty to keep)" : f.placeholder}
                  value={input.config[f.name] ?? ""}
                  onChange={(e) => setConfig(f.name, e.target.value)}
                  aria-invalid={err ? true : undefined}
                />
                {meta.type === "telegram" && f.name === "chatId" && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={detecting}
                    onClick={() =>
                      startDetect(async () => {
                        const res = await detectTelegramAction(input.config.botToken ?? "", channel?.id);
                        if (res.error) toast.error(res.error);
                        setChats(res.chats ?? null);
                      })
                    }
                  >
                    {detecting ? <Loader2Icon className="animate-spin" /> : <RadarIcon />}
                    Detect chat
                  </Button>
                )}
              </div>
              {meta.type === "telegram" && f.name === "chatId" && chats && (
                <div className="flex flex-wrap gap-1.5">
                  {chats.map((c) => (
                    <Button
                      key={c.id}
                      type="button"
                      size="sm"
                      variant={input.config.chatId === c.id ? "secondary" : "outline"}
                      onClick={() => setConfig("chatId", c.id)}
                    >
                      {c.name} <span className="text-muted-foreground">{c.type}</span>
                    </Button>
                  ))}
                </div>
              )}
              {f.help && !err && <FieldDescription>{f.help}</FieldDescription>}
              {err && <FieldError>{err}</FieldError>}
            </Field>
          );
        })}

        <FieldSet>
          <FieldLegend variant="label">Events</FieldLegend>
          <div className="space-y-2">
            {EVENT_TYPES.map((ev) => (
              <label key={ev} className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={input.events.includes(ev)}
                  onCheckedChange={(on) =>
                    setInput((s) => ({ ...s, events: toggle(s.events, ev, Boolean(on)) }))
                  }
                />
                <span>
                  <span className="font-medium">{EVENT_LABEL[ev]}</span>
                  <span className="block text-xs text-muted-foreground">{EVENT_HINT[ev]}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.events && <FieldError>{errors.events}</FieldError>}
        </FieldSet>

        <Field>
          <FieldLabel htmlFor="ch-severity">Package advisories</FieldLabel>
          <NativeSelect
            id="ch-severity"
            value={input.minSeverity}
            onChange={(e) => setInput((s) => ({ ...s, minSeverity: e.target.value as Severity }))}
          >
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
          <FieldDescription>
            Node security updates are always sent, whatever this filter says.
          </FieldDescription>
        </Field>

        <FieldSet>
          <FieldLegend variant="label">Projects</FieldLegend>
          <label className="flex items-center gap-2.5 text-sm">
            <Switch checked={scoped} onCheckedChange={setScoped} />
            Only selected projects
          </label>
          {scoped && (
            <div
              className={cn(
                "grid gap-2 sm:grid-cols-2",
                projects.length === 0 && "text-sm text-muted-foreground",
              )}
            >
              {projects.length === 0 && "No projects yet."}
              {projects.map((p) => (
                <label key={p.id} className="flex items-center gap-2.5 text-sm">
                  <Checkbox
                    checked={input.projects.includes(p.id)}
                    onCheckedChange={(on) =>
                      setInput((s) => ({ ...s, projects: toggle(s.projects, p.id, Boolean(on)) }))
                    }
                  />
                  {p.name}
                </label>
              ))}
            </div>
          )}
        </FieldSet>

        <label className="flex items-center gap-2.5 text-sm">
          <Switch checked={input.enabled} onCheckedChange={(v) => setInput((s) => ({ ...s, enabled: v }))} />
          Enabled
        </label>
      </FieldGroup>

      <DialogFooter className="mt-6">
        <Button
          type="button"
          variant="outline"
          disabled={testing}
          onClick={() =>
            startTest(async () => {
              const res = await testChannelAction(payload());
              setErrors(res.fieldErrors ?? {});
              if (res.ok) toast.success("Test message sent");
              else toast.error(res.error ?? "Test failed", { duration: 8000 });
            })
          }
        >
          {testing ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
          Send test
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2Icon className="animate-spin" />}
          {channel ? "Save" : "Add channel"}
        </Button>
      </DialogFooter>
    </form>
  );
}
