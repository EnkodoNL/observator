// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState, useTransition } from "react";
import { Loader2Icon, MoreHorizontalIcon, PencilIcon, PlusIcon, SendIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import type { ChannelView } from "@/lib/data/channels";
import { EVENT_TYPES } from "@/lib/issues/events";
import type { ChannelMeta } from "@/lib/notify/channels/types";
import { deleteChannelAction, testSavedChannelAction, toggleChannelAction } from "./actions";
import { ChannelDialog } from "./channel-dialog";

const SEVERITY_SHORT: Record<string, string> = {
  unknown: "all advisories",
  low: "low+",
  moderate: "moderate+",
  high: "high+",
  critical: "critical only",
};

export function ChannelList({
  channels,
  metas,
  projects,
}: {
  channels: ChannelView[];
  metas: ChannelMeta[];
  projects: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<ChannelView | "new" | null>(null);
  const [deleting, setDeleting] = useState<ChannelView | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [, start] = useTransition();
  const label = (type: string) => metas.find((m) => m.type === type)?.label ?? type;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <PlusIcon /> Add channel
        </Button>
      </div>

      {channels.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">No channels yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Add Slack, Telegram, e-mail or one of the others, and Observator tells you when a project needs a
            Node update or has a new vulnerable package.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {channels.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <Switch
                checked={c.enabled}
                aria-label={`${c.enabled ? "Disable" : "Enable"} ${c.name}`}
                onCheckedChange={(on) => start(() => toggleChannelAction(c.id, on))}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {c.name} <span className="text-sm font-normal text-muted-foreground">{label(c.type)}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.events.length === EVENT_TYPES.length ? "All events" : `${c.events.length} events`} ·{" "}
                  {c.projects.length ? `${c.projects.length} projects` : "all projects"} ·{" "}
                  {SEVERITY_SHORT[c.minSeverity]}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={testingId === c.id}
                onClick={async () => {
                  setTestingId(c.id);
                  const res = await testSavedChannelAction(c.id);
                  setTestingId(null);
                  if (res.ok) toast.success(`Test sent to ${c.name}`);
                  else toast.error(res.error ?? "Test failed", { duration: 8000 });
                }}
              >
                {testingId === c.id ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                <span className="hidden sm:inline">Send test</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`} />}
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => setEditing(c)}>
                    <PencilIcon /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleting(c)}>
                    <Trash2Icon /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <ChannelDialog
        metas={metas}
        projects={projects}
        channel={editing && editing !== "new" ? editing : undefined}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "channel"}?`}
        description="Its delivery log is removed too. Other channels are not affected."
        confirmLabel="Delete channel"
        destructive
        onConfirm={async () => {
          if (deleting) await deleteChannelAction(deleting.id);
          toast.success("Channel deleted");
        }}
      />
    </div>
  );
}
