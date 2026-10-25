// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import { EyeOffIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import { ignoreAction, unignoreAction } from "./actions";

function Choice({
  name,
  value,
  current,
  onChange,
  children,
}: {
  name: string;
  value: string;
  current: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
        className="mt-0.5 accent-foreground"
      />
      <span>{children}</span>
    </label>
  );
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function IgnoreDialog({
  projectId,
  projectName,
  osvId,
  pkg,
}: {
  projectId: string;
  projectName: string;
  osvId: string;
  pkg: string;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"project" | "all">("project");
  const [match, setMatch] = useState<"advisory" | "package">("advisory");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState(inDays(90));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="xs" />}>
        <EyeOffIcon /> Ignore
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await ignoreAction({ projectId, scope, match, osvId, pkg, reason, expiresAt });
              setErrors(res.fieldErrors ?? {});
              if (res.ok) {
                toast.success("Ignored. It stays visible, without notifications.");
                setOpen(false);
              } else toast.error(res.error ?? "Could not save");
            });
          }}
        >
          <DialogHeader className="mb-4">
            <DialogTitle>Ignore {match === "advisory" ? osvId : `all advisories for ${pkg}`}</DialogTitle>
            <DialogDescription>
              Ignored advisories stay listed as ignored, but do not count towards the status and do not
              notify.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <FieldSet>
              <FieldLegend variant="label">What</FieldLegend>
              <Choice
                name="match"
                value="advisory"
                current={match}
                onChange={(v) => setMatch(v as "advisory")}
              >
                This advisory <span className="font-mono text-xs text-muted-foreground">{osvId}</span>
              </Choice>
              <Choice name="match" value="package" current={match} onChange={(v) => setMatch(v as "package")}>
                Every advisory for <span className="font-mono text-xs">{pkg}</span>
              </Choice>
            </FieldSet>
            <FieldSet>
              <FieldLegend variant="label">Where</FieldLegend>
              <Choice name="scope" value="project" current={scope} onChange={(v) => setScope(v as "project")}>
                {projectName} only
              </Choice>
              <Choice name="scope" value="all" current={scope} onChange={(v) => setScope(v as "all")}>
                All projects
              </Choice>
            </FieldSet>
            <Field data-invalid={errors.reason ? true : undefined}>
              <FieldLabel htmlFor="ig-reason">Reason</FieldLabel>
              <Textarea
                id="ig-reason"
                value={reason}
                rows={2}
                placeholder="Only reachable from the admin CLI, which is not deployed."
                onChange={(e) => setReason(e.target.value)}
              />
              {errors.reason && <FieldError>{errors.reason}</FieldError>}
            </Field>
            <Field data-invalid={errors.expiresAt ? true : undefined}>
              <FieldLabel htmlFor="ig-expires">Until</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="ig-expires"
                  type="date"
                  className="w-44"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
                {[30, 90, 365].map((n) => (
                  <Button
                    key={n}
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => setExpiresAt(inDays(n))}
                  >
                    {n} days
                  </Button>
                ))}
                <Button type="button" size="xs" variant="ghost" onClick={() => setExpiresAt("")}>
                  Forever
                </Button>
              </div>
              <FieldDescription>
                When it expires, the advisory is reported again if it still applies.
              </FieldDescription>
              {errors.expiresAt && <FieldError>{errors.expiresAt}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Ignore
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UnignoreButton({ ignoreId }: { ignoreId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await unignoreAction(ignoreId);
          toast.success("No longer ignored");
        })
      }
    >
      {pending && <Loader2Icon className="animate-spin" />}
      Stop ignoring
    </Button>
  );
}
