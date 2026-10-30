// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createProject, rotateApiKey, setLabels } from "@/lib/data/projects";
import { analyzeDockerfile, type DockerfileNote } from "@/lib/dockerfile";
import { env } from "@/lib/env";
import { matchKey, sharedNameStatus } from "@/lib/ingest/resolve";
import { parseNames } from "@/lib/domains/names";
import { parseLabels } from "@/lib/labels";
import { defineTool, projectUrl, resolveProject, ToolError, type Tool } from "./tools";

const note = (level: DockerfileNote["level"], text: string): DockerfileNote => ({ level, text });

/**
 * Puts Observator into one Dockerfile: the snippet at the bottom, with the key, the project
 * name and the labels filled in as ARG defaults, so the build needs no extra configuration.
 */
export const installTools: Record<string, Tool> = {
  setup_dockerfile: defineTool({
    title: "Set up Observator in a Dockerfile",
    description: [
      "Returns the Dockerfile with the Observator snippet added (or an older snippet replaced) and a note per decision. Write the returned dockerfile back as is.",
      "Pick one way to authenticate:",
      "- key: a project key (obs_…) or shared key (obss_…), for example from the environment. It is checked, then written into the Dockerfile (embedKey: false leaves it to the OBSERVATOR_KEY build variable). With a shared key, give project: the name this Dockerfile's app reports as.",
      "- newProject: creates a project with its own key and writes that key in.",
      "- project + rotateKey: gives an existing project a new key (the old one stops working) and writes it in.",
      "- keyless: the snippet without the key check, for servers on a shared key's IP allowlist; give project as the name.",
      "labels become the default for OBSERVATOR_LABELS, such as app:heatwave,role:web; domains the default for OBSERVATOR_DOMAINS, the names the app is served on (app.example.com), whose certificates and registrations are then watched.",
      "To bring an existing snippet up to date, or switch it between the image and shell form while keeping its settings, use upgrade_observator instead.",
    ].join("\n"),
    input: z.object({
      dockerfile: z.string().min(1).max(200_000).describe("The Dockerfile's full content"),
      path: z.string().max(500).optional().describe("Where the Dockerfile is, for the notes"),
      key: z.string().max(200).optional(),
      embedKey: z.boolean().default(true),
      newProject: z.string().trim().min(1).max(100).optional(),
      project: z.string().trim().min(1).max(100).optional(),
      rotateKey: z.boolean().optional(),
      keyless: z.boolean().optional(),
      labels: z.string().max(2000).optional(),
      domains: z.string().max(2000).optional().describe("Comma-separated names the app is served on"),
      form: z
        .enum(["image", "shell"])
        .default("image")
        .describe(
          "image (default): a few lines that copy the reporter from its image, also for images without a shell. shell: plain sh, nothing to pull, for builds that cannot reach the registry.",
        ),
    }),
    write: true,
    run: async (args) => {
      const ways = [args.key, args.newProject, args.rotateKey, args.keyless].filter(Boolean).length;
      if (ways > 1) throw new ToolError("Pick one of key, newProject, project + rotateKey or keyless.");
      const { labels, invalid } = parseLabels(args.labels ?? "");
      if (invalid.length) throw new ToolError(`Not a label: ${invalid.join(", ")}`);
      const domains = parseNames(args.domains ?? "");
      if (domains.invalid.length)
        throw new ToolError(`Not a domain or hostname: ${domains.invalid.join(", ")}`);

      const notes: DockerfileNote[] = [];
      let key: string | undefined;
      let reportAs: string | undefined;
      let project: { slug: string; name: string; url: string } | null = null;
      let newKey: string | undefined;

      if (args.newProject) {
        const created = await createProject(args.newProject);
        if (labels.length) await setLabels(created.project.id, labels);
        key = newKey = created.apiKey;
        project = {
          slug: created.project.slug,
          name: created.project.name,
          url: projectUrl(created.project.slug),
        };
        notes.push(note("ok", `Created project ${created.project.name} with its own key.`));
      } else if (args.rotateKey) {
        if (!args.project) throw new ToolError("rotateKey needs project: the slug of the project.");
        const p = await resolveProject(args.project);
        key = newKey = await rotateApiKey(p.id);
        project = { slug: p.slug, name: p.name, url: projectUrl(p.slug) };
        notes.push(
          note("warn", `Gave ${p.name} a new key: builds that use the old one are no longer recorded.`),
        );
      } else if (args.key) {
        const match = await matchKey(args.key.trim());
        if (!match)
          throw new ToolError("That key is not known to Observator: no project key or shared key matches.");
        key = args.key.trim();
        if (match.kind === "project") {
          const p = match.project;
          project = { slug: p.slug, name: p.name, url: projectUrl(p.slug) };
          notes.push(note("ok", `The key belongs to project ${p.name}.`));
          if (args.project)
            notes.push(note("info", "A project key decides the project itself, so project is not used."));
        } else {
          reportAs = args.project;
          if (!reportAs) {
            notes.push(
              note(
                "info",
                `Shared key "${match.key.name}" without project: the name from package.json is used.`,
              ),
            );
          } else {
            const status = await sharedNameStatus(match.key, reportAs);
            if (status.conflict)
              notes.push(
                note(
                  "warn",
                  `"${reportAs}" is already the name of project ${status.conflict.name}, which this shared key did not create: its reports would be refused. Pick another project name.`,
                ),
              );
            else if (status.existing.length)
              notes.push(
                note(
                  "ok",
                  `Reports as "${reportAs}" with shared key "${match.key.name}", into ${status.existing.map((p) => p.name).join(", ")}.`,
                ),
              );
            else
              notes.push(
                note(
                  "ok",
                  `Shared key "${match.key.name}" creates project "${reportAs}" on its first report.`,
                ),
              );
          }
        }
      } else if (args.keyless) {
        reportAs = args.project;
        notes.push(
          note(
            "info",
            "Without a key, this build is only recorded from an address on a shared key's IP allowlist (Settings → Projects → Shared keys).",
          ),
        );
      } else {
        notes.push(
          note(
            "info",
            "No key given: set OBSERVATOR_KEY as a build variable, or call again with key, newProject or keyless.",
          ),
        );
        reportAs = args.project;
      }

      const embed = Boolean(key) && args.embedKey;
      if (key && !embed)
        notes.push(
          note("info", "The key is not in the Dockerfile: pass it as the OBSERVATOR_KEY build variable."),
        );
      if (embed)
        notes.push(
          note(
            "info",
            "The key is now in the Dockerfile, so in git. It can only report; if it leaks, rotate it (or revoke the shared key).",
          ),
        );

      const analysis = analyzeDockerfile(args.dockerfile, env().APP_URL, {
        key: embed ? key : undefined,
        project: reportAs,
        labels: labels.join(","),
        domains: domains.names.map((n) => n.host).join(","),
        keyless: args.keyless,
        form: args.form,
        image: env().REPORTER_IMAGE,
      });
      if (!analysis.ok) throw new ToolError(analysis.error);
      if (newKey) revalidatePath("/", "layout");
      if (analysis.existing?.key && !embed)
        notes.push(
          note(
            "warn",
            "The snippet that was there had a key written in; the new one has none. Pass key again, or use upgrade_observator to keep the old settings.",
          ),
        );

      return {
        path: args.path ?? null,
        form: args.form,
        dockerfile: `${analysis.lines.map((l) => l.text).join("\n")}\n`,
        notes: [...notes, ...analysis.notes],
        project,
        reportsAs: reportAs ?? null,
        labels,
        domains: domains.names.map((n) => n.host),
        ...(newKey && !embed ? { apiKey: newKey } : {}),
      };
    },
  }),
};

/** "/mcp__observator__install" in Claude Code: the steps for a whole repository. */
export function registerInstallPrompt(server: McpServer): void {
  server.registerPrompt(
    "install",
    {
      title: "Set up Observator in this repository",
      description:
        "Finds the Dockerfiles, names a project and labels per app, and adds Observator with setup_dockerfile.",
      argsSchema: z.object({
        auth: z
          .string()
          .optional()
          .describe("shared-key (from OBSERVATOR_KEY in the environment), allowlist, or project-key"),
        labels: z.string().optional().describe("Labels for every app, such as env:prod"),
      }),
    },
    ({ auth, labels }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Set up Observator in this repository.",
              "",
              "1. Find every Dockerfile (Dockerfile, Dockerfile.*, *.Dockerfile) that builds a deployable app. Skip ones for tooling or tests.",
              "2. Per app, pick a project name: the package.json name of the app it builds, or else its folder. Pick labels: app:<repository name>, role:<web|worker|...> when the repository has more than one app, env:<...> when it is obvious" +
                (labels ? `, plus: ${labels}` : "") +
                ".",
              "3. Authentication: " +
                (auth === "allowlist"
                  ? "keyless: true (the servers are on a shared key's IP allowlist)."
                  : auth === "project-key"
                    ? "newProject with the project name, one project per app."
                    : "the shared key in the environment (OBSERVATOR_KEY, or a .env file; ask me if there is none), passed as key, with project set to the app's name.") +
                " list_projects and list_shared_keys show what exists.",
              "4. Per Dockerfile, call setup_dockerfile with its content, path, labels and the authentication, and write the returned dockerfile back unchanged.",
              "5. Finish with a short overview per file: project, labels, the notes (especially warnings such as a name conflict), and anything left to configure.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

/** "/mcp__observator__upgrade": every snippet in a repository to one form, settings kept. */
export function registerUpgradePrompt(server: McpServer): void {
  server.registerPrompt(
    "upgrade",
    {
      title: "Upgrade Observator in this repository",
      description:
        "Finds the Dockerfiles that already report to Observator, brings their snippet to the current version, and asks about settings they do not use yet, such as domains.",
      argsSchema: z.object({
        form: z
          .string()
          .optional()
          .describe("image (the reporter image, the default) or shell (plain sh, nothing pulled)"),
      }),
    },
    ({ form }) => {
      const shell = form?.trim().toLowerCase() === "shell";
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                "Upgrade Observator in this repository.",
                "",
                '1. Find every Dockerfile (Dockerfile, Dockerfile.*, *.Dockerfile) with an Observator snippet: a "# --- Observator" line or a stage named observator.',
                `2. Per Dockerfile, call upgrade_observator with its content, path and form: "${shell ? "shell" : "image"}".`,
                "3. Collect the questions of all files. For each, work out a suggestion from what its lookIn names; never guess a domain that is not in the repository. Then ask me everything at once, per file, with your suggestions. An app without a public name, such as a worker, can leave domains empty.",
                "4. Call upgrade_observator again per file with the same dockerfile and my answers, an empty string for what I left empty, and write the returned dockerfile back unchanged.",
                "5. Finish with a short overview per file: the form before and after, what was added, what was kept, and the notes (especially warnings).",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
