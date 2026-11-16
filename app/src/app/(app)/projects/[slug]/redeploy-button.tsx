// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RocketLaunchIcon } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { redeployAction } from "./actions";

/**
 * target: what is called, for the confirmation. coolify: the project deploys on Coolify, where
 * Observator always asks for a rebuild without cache (a plain redeploy reuses the old image).
 */
export function RedeployButton({
  projectId,
  name,
  target,
  coolify,
}: {
  projectId: string;
  name: string;
  target: string;
  coolify: boolean;
}) {
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
          <RocketLaunchIcon /> Redeploy
        </Button>
      }
      title={`Redeploy ${name}?`}
      description={
        coolify
          ? `This has Coolify (${target}) rebuild the app without cache, so a moving tag such as node:26 gets its newest image. That takes longer than a normal deploy.`
          : `This calls the deploy webhook (${target}). Rebuilding pulls a newer base image only if the Dockerfile pins it or the build pulls.`
      }
      confirmLabel={coolify ? "Rebuild" : "Redeploy"}
      onConfirm={async () => {
        const res = await redeployAction(projectId);
        if (res.ok) toast.success(`${res.message} for ${name}`);
        else toast.error(`Redeploy failed: ${res.message}`, { duration: 10000 });
      }}
    />
  );
}
