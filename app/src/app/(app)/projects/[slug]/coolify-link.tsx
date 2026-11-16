// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CircleNotchIcon } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { coolifyApplicationsAction, linkCoolifyAction } from "./actions";

type App = Awaited<ReturnType<typeof coolifyApplicationsAction>>["apps"][number];

const SOURCE = {
  build: "from the build (COOLIFY_RESOURCE_UUID)",
  picked: "picked by hand",
  self: "Observator itself",
} as const;

/**
 * Which Coolify application the project is. Dockerfile apps link themselves through their build;
 * Docker Compose apps get the uuid only at runtime, so those are picked here.
 */
export function CoolifyLink({
  projectId,
  link,
  servers,
}: {
  projectId: string;
  link: { uuid: string; server: string | null; source: keyof typeof SOURCE } | null;
  servers: number;
}) {
  const [apps, setApps] = useState<App[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [pending, start] = useTransition();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (apps ?? []).filter(
      (a) => !q || a.name.toLowerCase().includes(q) || a.domains.some((d) => d.includes(q)),
    );
  }, [apps, query]);

  const save = (uuid: string | null) =>
    start(async () => {
      const res = await linkCoolifyAction(projectId, uuid);
      if (res.error) toast.error(res.error);
      else {
        toast.success(uuid ? "Linked to Coolify" : "Unlinked from Coolify");
        setApps(null);
      }
    });

  if (servers === 0 && !link)
    return (
      <p className="max-w-xl text-sm text-muted-foreground">
        Connect your Coolify server under{" "}
        <Link href="/settings/coolify" className="underline underline-offset-4">
          Settings → Coolify
        </Link>
        . Then Observator compares Coolify&rsquo;s deploys with the reports, watches the domains and can
        redeploy, without a deploy webhook.
      </p>
    );

  return (
    <div className="max-w-xl space-y-3 text-sm">
      {link ? (
        <p>
          Linked to application <span className="font-mono">{link.uuid}</span>
          {link.server ? ` on ${link.server}` : " (no connected server has it yet)"}, {SOURCE[link.source]}.
        </p>
      ) : (
        <p className="text-muted-foreground">
          Not linked. A Dockerfile app links itself on its next build; a Docker Compose app is picked here.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await coolifyApplicationsAction();
              setApps(res.apps);
              setErrors(res.errors);
            })
          }
        >
          {pending && apps === null && <CircleNotchIcon className="animate-spin" />}
          {link ? "Pick another application" : "Pick an application"}
        </Button>
        {link && (
          <Button variant="ghost" disabled={pending} onClick={() => save(null)}>
            Unlink
          </Button>
        )}
      </div>
      {errors.map((e) => (
        <p key={e} className="text-warn">
          {e}
        </p>
      ))}
      {apps && (
        <div className="space-y-2">
          <Input
            placeholder="Search by name or domain"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search Coolify applications"
          />
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {shown.length === 0 && <li className="px-3 py-2 text-muted-foreground">No application found.</li>}
            {shown.map((a) => (
              <li key={`${a.serverName}/${a.uuid}`}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => save(a.uuid)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                >
                  <span className="font-medium">
                    {a.name}
                    {a.uuid === link?.uuid && (
                      <span className="ml-2 text-xs text-muted-foreground">linked</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {[a.serverName, a.buildPack, ...a.domains].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
