// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useTransition } from "react";
import { CircleNotchIcon, PaperPlaneTiltIcon, PlayIcon } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runChecksAction, sendDigestNowAction } from "./actions";

export function CheckButtons() {
  const [checking, startCheck] = useTransition();
  const [sending, startSend] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        disabled={checking}
        onClick={() =>
          startCheck(async () => {
            const res = await runChecksAction();
            if (res.ok) toast.success("Runtime releases and package advisories checked");
            else toast.error(res.error ?? "Check failed");
          })
        }
      >
        {checking ? <CircleNotchIcon className="animate-spin" /> : <PlayIcon />}
        Run checks now
      </Button>
      <Button
        variant="outline"
        disabled={sending}
        onClick={() =>
          startSend(async () => {
            await sendDigestNowAction();
            toast.success("Digest queued for channels that receive it");
          })
        }
      >
        {sending ? <CircleNotchIcon className="animate-spin" /> : <PaperPlaneTiltIcon />}
        Send digest now
      </Button>
    </div>
  );
}
