// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { WEBHOOK_TOKEN, WEBHOOK_URL } from "@/lib/data/projects";
import { secretFields } from "@/lib/notify/channels";
import { adminPb } from "@/lib/pb/admin";
import type { ChannelRecord, CoolifyServerRecord, ProjectRecord } from "@/lib/pb/types";
import { SERVER_TOKEN } from "@/lib/coolify/servers";
import { isCurrent, seal, secretsKeySet, unseal } from "@/lib/secrets";

/**
 * At startup: encrypts stored secrets that are still plain text (from before SECRETS_KEY) or
 * under the previous key (after a rotation), so the database holds them under the current key
 * only. Without a key it only warns about what lies there unencrypted.
 */
export async function sealStoredSecrets(): Promise<void> {
  const pb = await adminPb();
  const [projects, channels, servers] = await Promise.all([
    pb.collection("projects").getFullList<ProjectRecord>({
      filter: 'deployWebhookUrl != "" || deployWebhookToken != ""',
      fields: "id,deployWebhookUrl,deployWebhookToken",
    }),
    pb.collection("channels").getFullList<ChannelRecord>({ fields: "id,type,config" }),
    pb.collection("coolify_servers").getFullList<CoolifyServerRecord>({ fields: "id,token" }),
  ]);

  const stale = (v: unknown): v is string => typeof v === "string" && v !== "" && !isCurrent(v);
  const work: { label: string; save: () => Promise<unknown> }[] = [];
  for (const p of projects) {
    const fields = [
      ["deployWebhookUrl", WEBHOOK_URL],
      ["deployWebhookToken", WEBHOOK_TOKEN],
    ] as const;
    if (!fields.some(([f]) => stale(p[f]))) continue;
    work.push({
      label: `project ${p.id}`,
      save: () =>
        pb
          .collection("projects")
          .update(
            p.id,
            Object.fromEntries(
              fields.filter(([f]) => stale(p[f])).map(([f, ctx]) => [f, seal(unseal(p[f], ctx), ctx)]),
            ),
          ),
    });
  }
  for (const c of channels) {
    const config = { ...((c.config ?? {}) as Record<string, string>) };
    const names = secretFields(c.type).filter((f) => stale(config[f]));
    if (!names.length) continue;
    work.push({
      label: `channel ${c.id}`,
      save: () => {
        for (const f of names) {
          const ctx = `channels.${c.type}.${f}`;
          config[f] = seal(unseal(config[f], ctx), ctx);
        }
        return pb.collection("channels").update(c.id, { config });
      },
    });
  }

  for (const s of servers) {
    if (!stale(s.token)) continue;
    work.push({
      label: `Coolify server ${s.id}`,
      save: () =>
        pb
          .collection("coolify_servers")
          .update(s.id, { token: seal(unseal(s.token, SERVER_TOKEN), SERVER_TOKEN) }),
    });
  }

  if (work.length === 0) return;
  if (!secretsKeySet()) {
    console.warn(
      `[secrets] ${work.length} record(s) hold secrets without encryption; set SECRETS_KEY to encrypt them`,
    );
    return;
  }
  let sealed = 0;
  for (const w of work) {
    try {
      await w.save();
      sealed++;
    } catch (err) {
      console.error(`[secrets] could not encrypt ${w.label}`, err);
    }
  }
  console.info(`[secrets] encrypted the stored secrets of ${sealed} record(s) under the current key`);
}
