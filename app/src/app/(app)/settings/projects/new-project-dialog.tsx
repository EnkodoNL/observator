// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { PlusIcon } from "@phosphor-icons/react/ssr";
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
import { FieldGroup } from "@/components/ui/field";
import { FormMessage, SubmitButton, TextField } from "@/components/form";
import { KeyReveal } from "@/components/key-reveal";
import { createProjectAction, type CreatedProject } from "./actions";

export function NewProjectDialog({ appUrl }: { appUrl: string }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFormKey((k) => k + 1);
      }}
    >
      <DialogTrigger render={<Button />}>
        <PlusIcon /> New project
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] grid-cols-1 overflow-y-auto sm:max-w-2xl">
        <NewProjectForm key={formKey} appUrl={appUrl} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewProjectForm({ appUrl, onDone }: { appUrl: string; onDone: () => void }) {
  const [state, action] = useActionState<CreatedProject, FormData>(createProjectAction, {});

  if (state.ok && state.apiKey && state.project) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{state.project.name} is ready</DialogTitle>
          <DialogDescription>Two steps and your next build reports in.</DialogDescription>
        </DialogHeader>
        <KeyReveal apiKey={state.apiKey} appUrl={appUrl} />
        <DialogFooter>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/projects/${state.project.slug}`} />}
            onClick={onDone}
          >
            Open project
          </Button>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form action={action}>
      <DialogHeader className="mb-4">
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>One project per app or container image.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <TextField label="Name" name="name" placeholder="my-api" autoFocus required state={state} />
        <FormMessage state={state} />
      </FieldGroup>
      <DialogFooter className="mt-4">
        <SubmitButton>Create project</SubmitButton>
      </DialogFooter>
    </form>
  );
}
