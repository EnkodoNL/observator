// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RocketIcon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { redeployAction } from "./actions";

export function RedeployButton({ projectId, name, target }: { projectId: string; name: string; target: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Notification links end in ?redeploy=1: open the confirmation, never deploy directly.
  useEffect(() => {
    if (params.get("redeploy") === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
      router.replace(pathname, { scroll: false });
    }
  }, [params, pathname, router]);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <RocketIcon /> Redeploy
        </Button>
      }
      title={`Redeploy ${name}?`}
      description={`This calls the deploy webhook (${target}). Rebuilding pulls a newer base image only if the Dockerfile pins it or the build pulls.`}
      confirmLabel="Redeploy"
      onConfirm={async () => {
        const res = await redeployAction(projectId);
        if (res.ok) toast.success(`${res.message} for ${name}`);
        else toast.error(`Redeploy failed: ${res.message}`, { duration: 10000 });
      }}
    />
  );
}
