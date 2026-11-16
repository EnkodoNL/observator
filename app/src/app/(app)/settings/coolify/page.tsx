// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/session";
import { listServers, toServerView } from "@/lib/coolify/servers";
import { adminPb } from "@/lib/pb/admin";
import type { ProjectRecord } from "@/lib/pb/types";
import { secretsKeySet } from "@/lib/secrets";
import { CoolifyServers } from "./coolify-servers";

export const metadata: Metadata = { title: "Coolify" };

export default async function CoolifySettingsPage() {
  await requireUser();
  const pb = await adminPb();
  const [servers, linked] = await Promise.all([
    listServers(),
    pb
      .collection("projects")
      .getFullList<ProjectRecord>({ filter: 'coolifyUuid != ""', fields: "coolifyServer" }),
  ]);
  const count = (id: string) => linked.filter((p) => p.coolifyServer === id).length;

  return (
    <section>
      <PageHeader
        title="Coolify"
        description="Connect a Coolify server once. Projects on it compare their deploys with the reports, bring their domains along and can be redeployed, without a deploy webhook per project."
      />
      <div className="mb-6 max-w-2xl space-y-2 text-sm text-muted-foreground">
        <p>
          Make an API token in Coolify (<em>Keys &amp; Tokens → API Tokens</em>) with the{" "}
          <code className="font-mono text-foreground">read</code> and{" "}
          <code className="font-mono text-foreground">deploy</code> permissions, nothing more. Read lists the
          applications, their domains and deploys; deploy starts a redeploy.
        </p>
        <p>
          Dockerfile apps link themselves: Coolify passes{" "}
          <code className="font-mono text-foreground">COOLIFY_RESOURCE_UUID</code> to every build and the
          snippet sends it along. A Docker Compose app gets that value only at runtime; pick it on the
          project&rsquo;s Setup tab.
        </p>
      </div>
      <CoolifyServers
        servers={servers.map((s) => ({ ...toServerView(s), projects: count(s.id) }))}
        canStore={secretsKeySet()}
      />
    </section>
  );
}
