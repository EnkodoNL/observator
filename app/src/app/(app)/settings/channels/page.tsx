// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listChannels, recentNotifications, toView } from "@/lib/data/channels";
import { listProjects } from "@/lib/data/projects";
import { EVENT_LABEL, type EventType } from "@/lib/issues/events";
import { channelMetas } from "@/lib/notify/channels";
import type { Message } from "@/lib/notify/message";
import { pbDate } from "@/lib/pb/admin";
import { formatDateTime, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ChannelList } from "./channel-list";

export const metadata: Metadata = { title: "Notifications" };

export default async function ChannelsPage() {
  const [channels, projects, log] = await Promise.all([
    listChannels(),
    listProjects(),
    recentNotifications(),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <PageHeader
          title="Notifications"
          description="Each problem is reported once per project, bundled per build or check. Delivery happens in the background with retries."
        />
        <ChannelList
          channels={channels.map(toView)}
          metas={channelMetas()}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        />
      </section>

      <section>
        <PageHeader title="Recent deliveries" description="The last 30 messages, across all channels." />
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.map((n) => {
                  const created = pbDate(n.created);
                  return (
                    <TableRow key={n.id}>
                      <TableCell
                        className="whitespace-nowrap text-muted-foreground"
                        title={formatDateTime(created)}
                      >
                        {timeAgo(created)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{n.channelName}</TableCell>
                      <TableCell className="max-w-sm">
                        <span className="block truncate">
                          {(n.payload as Message | null)?.title ?? EVENT_LABEL[n.event as EventType]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {EVENT_LABEL[n.event as EventType] ?? n.event}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <span
                          className={cn(
                            "text-xs font-medium",
                            n.status === "sent" && "text-ok",
                            n.status === "failed" && "text-danger",
                            n.status === "pending" && "text-warn",
                          )}
                        >
                          {n.status}
                          {n.attempts > 1 && ` after ${n.attempts} attempts`}
                        </span>
                        {n.error && n.status !== "sent" && (
                          <span className="block truncate text-xs text-muted-foreground" title={n.error}>
                            {n.error}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
