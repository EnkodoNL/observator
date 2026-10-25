// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Settings } from "@/lib/settings";
import { saveSettingsAction } from "./actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function SettingsForm({ initial, timezones }: { initial: Settings; timezones: string[] }) {
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof Settings>(key: K, v: Settings[K]) => setValue((s) => ({ ...s, [key]: v }));

  return (
    <form
      className="max-w-xl"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveSettingsAction(value);
          setErrors(res.fieldErrors ?? {});
          if (res.error) toast.error(res.error);
          else toast.success("Settings saved");
        });
      }}
    >
      <FieldGroup>
        <Field data-invalid={errors.staleDays ? true : undefined}>
          <FieldLabel htmlFor="staleDays">Stale after</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="staleDays"
              type="number"
              min={1}
              max={365}
              className="w-24"
              value={value.staleDays}
              onChange={(e) => set("staleDays", Number(e.target.value))}
            />
            <span className="text-sm text-muted-foreground">days without a build</span>
          </div>
          <FieldDescription>Stale projects are dimmed on the dashboard and reported once.</FieldDescription>
          {errors.staleDays && <FieldError>{errors.staleDays}</FieldError>}
        </Field>

        <Field data-invalid={errors.renotifyDays ? true : undefined}>
          <FieldLabel htmlFor="renotifyDays">Remind about open issues</FieldLabel>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">every</span>
            <Input
              id="renotifyDays"
              type="number"
              min={0}
              max={365}
              className="w-24"
              value={value.renotifyDays}
              onChange={(e) => set("renotifyDays", Number(e.target.value))}
            />
            <span className="text-sm text-muted-foreground">days (0 = never)</span>
          </div>
          <FieldDescription>
            Each problem is reported once. A reminder repeats it while it stays open.
          </FieldDescription>
          {errors.renotifyDays && <FieldError>{errors.renotifyDays}</FieldError>}
        </Field>

        <Field orientation="horizontal">
          <Switch
            id="digestEnabled"
            checked={value.digestEnabled}
            onCheckedChange={(v) => set("digestEnabled", v)}
          />
          <FieldLabel htmlFor="digestEnabled">Weekly digest</FieldLabel>
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="digestDay">Day</FieldLabel>
            <NativeSelect
              id="digestDay"
              value={value.digestDay}
              disabled={!value.digestEnabled}
              onChange={(e) => set("digestDay", Number(e.target.value))}
            >
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="digestHour">Time</FieldLabel>
            <NativeSelect
              id="digestHour"
              value={value.digestHour}
              disabled={!value.digestEnabled}
              onChange={(e) => set("digestHour", Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field data-invalid={errors.timezone ? true : undefined}>
            <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
            <NativeSelect
              id="timezone"
              value={value.timezone}
              onChange={(e) => set("timezone", e.target.value)}
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </NativeSelect>
            {errors.timezone && <FieldError>{errors.timezone}</FieldError>}
          </Field>
        </div>

        <div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" />}
            Save settings
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
