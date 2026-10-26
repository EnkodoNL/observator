// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CHANNEL_TYPES, getChannel, saveChannel, testSavedChannel } from "@/lib/data/channels";
import { expireIgnore, createIgnore } from "@/lib/data/ignores";
import { createIngestKey, listIngestKeys, updateSharedKey } from "@/lib/data/ingest-keys";
import {
  createProject,
  listProjects,
  projectSettingsSchema,
  rotateApiKey,
  saveProjectSettings,
  setLabels,
} from "@/lib/data/projects";
import { triggerRedeploy } from "@/lib/deploy";
import { displayEntry } from "@/lib/ingest/allowlist";
import { EVENT_TYPES } from "@/lib/issues/events";
import { runAllChecks } from "@/lib/jobs/checks";
import { jobStates } from "@/lib/jobs/scheduler";
import { effectiveLabels, parseLabels } from "@/lib/labels";
import { SEVERITIES } from "@/lib/pb/types";
import { getSettings, saveSettings, settingsSchema } from "@/lib/settings";
import { buildCommand } from "@/lib/snippet";
import { defineTool, iso, projectRef, projectUrl, resolveProject, ToolError, type Tool } from "./tools";

const labelsInput = z
  .string()
  .max(2000)
  .describe('Comma-separated, each a word or key:value, such as "app:heatwave, env:prod"');

function labelsOrThrow(text: string): string[] {
  const { labels, invalid } = parseLabels(text);
  if (invalid.length)
    throw new ToolError(`Not a label: ${invalid.join(", ")}. Use a word or key:value with a-z 0-9 . _ - /.`);
  return labels;
}

const changed = () => revalidatePath("/", "layout");

async function resolveSharedKey(ref: string) {
  const keys = await listIngestKeys();
  const key =
    keys.find((k) => k.id === ref) ?? keys.find((k) => k.name.toLowerCase() === ref.trim().toLowerCase());
  if (!key) throw new ToolError(`No shared key with id or name "${ref}". list_shared_keys shows them.`);
  return key;
}

export const writeTools: Record<string, Tool> = {
  create_project: defineTool({
    title: "Create a project",
    description:
      "Creates a project with its own API key, shown once in the result. For several apps at once, a shared key (create_shared_key) is usually easier: it creates projects on their first report. To also put Observator into a Dockerfile, use setup_dockerfile with newProject instead.",
    input: z.object({ name: z.string().trim().min(1).max(100), labels: labelsInput.optional() }),
    write: true,
    run: async ({ name, labels }) => {
      const own = labels ? labelsOrThrow(labels) : [];
      const { project, apiKey } = await createProject(name);
      if (own.length) await setLabels(project.id, own);
      changed();
      return {
        project: { slug: project.slug, name: project.name, url: projectUrl(project.slug), labels: own },
        apiKey,
        buildCommand: buildCommand(apiKey),
        note: "The key is shown only now. Pass it as the build argument OBSERVATOR_KEY (in Coolify: a build variable).",
      };
    },
  }),

  update_project: defineTool({
    title: "Update a project",
    description:
      "Changes a project's name, its own labels (replacing them; labels from builds stay) or its deploy webhook. Fields left out stay as they are; the webhook URL and token are never shown back.",
    input: z.object({
      project: projectRef,
      name: z.string().trim().min(1).max(100).optional(),
      labels: labelsInput
        .optional()
        .describe("The project's own labels, replacing the current ones; empty clears them"),
      deployWebhook: z
        .object({
          url: z.url().optional(),
          method: z.enum(["GET", "POST"]).optional(),
          token: z.string().max(1024).optional().describe("Bearer token for the webhook, if it needs one"),
          clear: z.boolean().optional().describe("Remove the webhook"),
        })
        .optional(),
    }),
    write: true,
    idempotent: true,
    run: async ({ project: ref, name, labels, deployWebhook }) => {
      let p = await resolveProject(ref);
      if (name !== undefined || deployWebhook) {
        const settings = projectSettingsSchema.parse({
          name: name ?? p.name,
          deployWebhookUrl: deployWebhook?.url ?? "",
          deployWebhookMethod: deployWebhook?.method ?? (p.deployWebhookMethod || "GET"),
          deployWebhookToken: deployWebhook?.token ?? "",
          clearWebhook: Boolean(deployWebhook?.clear),
        });
        p = await saveProjectSettings(p.id, settings);
      }
      if (labels !== undefined) p = await setLabels(p.id, labelsOrThrow(labels));
      changed();
      return {
        slug: p.slug,
        name: p.name,
        url: projectUrl(p.slug),
        labels: { own: p.labels ?? [], fromBuild: p.buildLabels ?? [], all: effectiveLabels(p) },
        deployWebhook: p.deployWebhookUrl ? { method: p.deployWebhookMethod || "GET" } : null,
      };
    },
  }),

  rotate_project_key: defineTool({
    title: "Rotate a project's API key",
    description:
      "Gives a project a new API key, shown once. The old key stops working immediately: builds that still use it are no longer recorded. A project created by a shared key gets its own key and leaves the shared key.",
    input: z.object({ project: projectRef }),
    write: true,
    destructive: true,
    run: async ({ project: ref }) => {
      const p = await resolveProject(ref);
      if (p.apiKeyPrefix === "self") throw new ToolError("Observator's own project reports without a key.");
      const apiKey = await rotateApiKey(p.id);
      changed();
      return {
        project: { slug: p.slug, url: projectUrl(p.slug) },
        apiKey,
        buildCommand: buildCommand(apiKey),
        warning: "The previous key no longer works. Update OBSERVATOR_KEY wherever it was used.",
      };
    },
  }),

  ignore_advisory: defineTool({
    title: "Ignore an advisory",
    description:
      "Stops an advisory (by OSV id) or every advisory of a package from counting, for one project or all, with a reason and optionally an end date. Ignored advisories stay visible as ignored; end_ignore brings one back.",
    input: z
      .object({
        project: projectRef.optional(),
        allProjects: z.boolean().optional().describe("Ignore in every project instead of one"),
        osvId: z.string().max(128).optional().describe("Such as GHSA-35jh-r3h4-6jhm"),
        package: z.string().max(214).optional().describe("Ignore every advisory of this package instead"),
        reason: z.string().trim().min(3).max(1000).describe("Why, for whoever looks at this later"),
        expiresAt: z.iso.date().optional().describe("YYYY-MM-DD; after that day the advisory counts again"),
      })
      .refine(
        (v) => Boolean(v.project) !== Boolean(v.allProjects),
        "Give either project or allProjects: true",
      )
      .refine((v) => Boolean(v.osvId) !== Boolean(v.package), "Give either osvId or package"),
    write: true,
    run: async ({ project: ref, allProjects, osvId, package: pkg, reason, expiresAt }, caller) => {
      const p = ref ? await resolveProject(ref) : null;
      const id = await createIgnore(
        {
          projectId: p?.id ?? "all",
          scope: allProjects ? "all" : "project",
          match: osvId ? "advisory" : "package",
          osvId: osvId ?? "",
          pkg: pkg ?? "",
          reason,
          expiresAt: expiresAt ?? "",
        },
        caller.userId,
      );
      return {
        ignoreId: id,
        scope: p ? p.slug : "all projects",
        match: osvId ?? `package ${pkg}`,
        expiresAt: expiresAt ?? null,
      };
    },
  }),

  end_ignore: defineTool({
    title: "End an ignore",
    description:
      "Lets an ignore expire now, so the advisory counts and notifies again. The ignore stays on record (who, why, until when); get_project lists ignoreIds.",
    input: z.object({ ignoreId: z.string().min(1).max(32) }),
    write: true,
    idempotent: true,
    run: async ({ ignoreId }) => {
      const ig = await expireIgnore(ignoreId);
      return { ignoreId: ig.id, endedAt: iso(ig.expiresAt) };
    },
  }),

  run_checks: defineTool({
    title: "Run checks now",
    description:
      "Fetches Node releases, re-checks every package against OSV and refreshes the latest npm versions, then re-evaluates all projects. Runs in the background; get_settings shows when each check finished.",
    input: z.object({}),
    write: true,
    idempotent: true,
    openWorld: true,
    run: async () => {
      after(async () => {
        const result = await runAllChecks();
        if (!result.ok) console.warn(`[mcp] run_checks: ${result.error}`);
        changed();
      });
      return { started: true, previousRuns: await jobStates() };
    },
  }),

  redeploy: defineTool({
    title: "Redeploy a project",
    description:
      "Calls the project's deploy webhook (Coolify, Dokploy, Portainer), for example after pinning a newer Node image. Only for projects with a webhook (see get_project).",
    input: z.object({ project: projectRef }),
    write: true,
    openWorld: true,
    run: async ({ project: ref }) => {
      const p = await resolveProject(ref);
      if (!p.deployWebhookUrl)
        throw new ToolError(`${p.name} has no deploy webhook; set one with update_project.`);
      const result = await triggerRedeploy(p);
      return { project: p.slug, ...result };
    },
  }),

  create_shared_key: defineTool({
    title: "Create a shared key",
    description:
      "One write-only key for many apps: each build names its project (OBSERVATOR_PROJECT or package.json) and the project is created on its first report. The key is shown once.",
    input: z.object({
      name: z.string().trim().min(1).max(100),
      onePerServer: z
        .boolean()
        .default(true)
        .describe("The same name from different source IPs becomes separate projects; off for CI runners"),
    }),
    write: true,
    run: async ({ name, onePerServer }, caller) => {
      const { record, key } = await createIngestKey(name, onePerServer, caller.userId);
      changed();
      return {
        id: record.id,
        name: record.name,
        key,
        note: "Shown only now. Give it to builds as OBSERVATOR_KEY, each with its own OBSERVATOR_PROJECT; setup_dockerfile can write both into a Dockerfile.",
      };
    },
  }),

  update_shared_key: defineTool({
    title: "Update a shared key",
    description:
      "Renames a shared key, switches one-project-per-server, or replaces its IP allowlist (builds from these addresses may report without a key). An address can belong to one shared key only.",
    input: z.object({
      key: z.string().min(1).max(100).describe("The shared key's id or name"),
      name: z.string().trim().min(1).max(100).optional(),
      onePerServer: z.boolean().optional(),
      allowlist: z
        .string()
        .max(20_000)
        .optional()
        .describe(
          'One address or CIDR range per line, "#" starts a note; replaces the whole list. An IPv6 server subnet is written with its prefix, such as 2a01:4f8:c2c:9793::/64',
        ),
    }),
    write: true,
    idempotent: true,
    run: async ({ key: ref, name, onePerServer, allowlist }) => {
      const key = await resolveSharedKey(ref);
      const res = await updateSharedKey(key.id, { name, splitByIp: onePerServer, allowlist });
      if (res.error || !res.key) throw new ToolError(res.error ?? "Could not update the key.");
      changed();
      return {
        id: res.key.id,
        name: res.key.name,
        onePerServer: res.key.splitByIp,
        allowlist: (res.key.allowedIps ?? []).map((e) => ({ address: displayEntry(e.cidr), note: e.note })),
      };
    },
  }),

  update_settings: defineTool({
    title: "Update settings",
    description:
      "Stale days, reminder interval, weekly digest (day 0 = Sunday, hour) and timezone. Fields left out stay.",
    input: settingsSchema.partial(),
    write: true,
    idempotent: true,
    run: async (changes) => {
      const next = settingsSchema.parse({ ...(await getSettings()), ...changes });
      await saveSettings(next);
      changed();
      return { settings: next };
    },
  }),

  save_channel: defineTool({
    title: "Create or update a notification channel",
    description:
      "Creates a channel, or updates one when id is given (list_channels shows ids and which config fields each type has). Secret config fields left empty keep their stored value. Projects are slugs; none means all.",
    input: z.object({
      id: z.string().max(32).optional(),
      type: z.enum(CHANNEL_TYPES).optional().describe("Required for a new channel"),
      name: z.string().trim().min(1).max(100).optional(),
      enabled: z.boolean().optional(),
      minSeverity: z
        .enum(SEVERITIES as [string, ...string[]])
        .optional()
        .describe("For package advisories only"),
      events: z.array(z.enum(EVENT_TYPES)).optional().describe("Leave out for all events"),
      projects: z.array(z.string()).optional(),
      config: z.record(z.string(), z.string()).optional(),
    }),
    write: true,
    openWorld: true,
    run: async ({ id, projects: slugs, ...rest }) => {
      const existing = id ? await getChannel(id) : null;
      if (!existing && !rest.type) throw new ToolError("A new channel needs a type.");
      const all = slugs ? await listProjects() : [];
      const projectIds = slugs?.map((s) => {
        const p = all.find((x) => x.slug === s || x.name === s);
        if (!p) throw new ToolError(`No project ${s}.`);
        return p.id;
      });
      const res = await saveChannel({
        id,
        type: rest.type ?? existing?.type,
        name: rest.name ?? existing?.name,
        enabled: rest.enabled ?? existing?.enabled ?? true,
        minSeverity: rest.minSeverity ?? (existing?.minSeverity || "unknown"),
        events: rest.events ?? (existing?.events?.length ? existing.events : [...EVENT_TYPES]),
        projects: projectIds ?? existing?.projects ?? [],
        config: rest.config ?? {},
      });
      if (!res.ok)
        throw new ToolError(
          [res.error, ...Object.entries(res.fieldErrors ?? {}).map(([k, v]) => `${k}: ${v}`)]
            .filter(Boolean)
            .join("; "),
        );
      revalidatePath("/settings/channels");
      return { id: res.id, saved: true, note: "test_channel sends a test message." };
    },
  }),

  test_channel: defineTool({
    title: "Send a test notification",
    description: "Sends a test message through a saved channel.",
    input: z.object({ id: z.string().min(1).max(32) }),
    write: true,
    idempotent: true,
    openWorld: true,
    run: async ({ id }) => {
      const res = await testSavedChannel(id);
      if (!res.ok) throw new ToolError(res.error ?? "The test failed.");
      return { sent: true };
    },
  }),
};
