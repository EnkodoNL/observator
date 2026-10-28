// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { JOBS, type JobName } from "@/lib/jobs/jobs";
import { jobStates } from "@/lib/jobs/scheduler";
import { getSettings } from "@/lib/settings";
import { timeAgo } from "@/lib/time";
import { CheckButtons } from "./checks";
import { SettingsForm } from "./settings-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "General settings" };

export default async function GeneralSettingsPage() {
  await requireUser();
  const [settings, states] = await Promise.all([getSettings(), jobStates()]);
  const timezones = Intl.supportedValuesOf("timeZone");
  if (!timezones.includes(settings.timezone)) timezones.unshift(settings.timezone);

  return (
    <div className="space-y-10">
      <section>
        <PageHeader
          title="General"
          description="When projects count as stale, reminders, and the weekly digest."
        />
        <SettingsForm initial={settings} timezones={timezones} />
      </section>

      <section>
        <PageHeader
          title="Background checks"
          description="Run inside the web process. Runtime releases are checked hourly, package advisories daily."
          actions={<CheckButtons />}
        />
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Check</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(Object.keys(JOBS) as JobName[]).map((name) => {
                const s = states[name];
                return (
                  <TableRow key={name}>
                    <TableCell>{JOBS[name].label}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {s ? timeAgo(new Date(s.lastRun)) : "never"}
                    </TableCell>
                    <TableCell className="max-w-md truncate">
                      {!s ? (
                        <span className="text-muted-foreground">waiting</span>
                      ) : s.ok ? (
                        <span className="text-ok">ok</span>
                      ) : (
                        <span className="text-danger" title={s.error}>
                          {s.error}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
