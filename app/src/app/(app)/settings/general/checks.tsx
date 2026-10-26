// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useTransition } from "react";
import { Loader2Icon, PlayIcon, SendIcon } from "lucide-react";
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
        {checking ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
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
        {sending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
        Send digest now
      </Button>
    </div>
  );
}
