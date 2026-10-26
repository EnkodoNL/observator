// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { McpCaller } from "@/lib/data/mcp-tokens";
import { getProjectBySlug, listProjects } from "@/lib/data/projects";
import { env } from "@/lib/env";
import { pbDate } from "@/lib/pb/admin";
import type { ProjectRecord } from "@/lib/pb/types";

/** A mistake the client can fix (an unknown project, a bad value): its message is shown as is. */
export class ToolError extends Error {}

interface ToolDef<S extends z.ZodObject> {
  title: string;
  description: string;
  input: S;
  /** Changes something: only offered to tokens that may write, and logged. Never deletes. */
  write?: boolean;
  /** For write tools: undoes something the user relies on (a key stops working). */
  destructive?: boolean;
  idempotent?: boolean;
  /** Reaches outside Observator (a deploy webhook, a chat service). */
  openWorld?: boolean;
  run: (args: z.infer<S>, caller: McpCaller) => Promise<Record<string, unknown>>;
}

export interface Tool extends Omit<ToolDef<z.ZodObject>, "run"> {
  run: (args: unknown, caller: McpCaller) => Promise<Record<string, unknown>>;
}

export function defineTool<S extends z.ZodObject>(def: ToolDef<S>): Tool {
  return { ...def, run: (args, caller) => def.run(def.input.parse(args), caller) };
}

/** Arguments for the log line: long text shortened, anything secret-looking left out. */
export function brief(args: unknown): string {
  return JSON.stringify(args, (key, value) =>
    /token|secret|password|config|key$/i.test(key) && key !== "project"
      ? "…"
      : typeof value === "string" && value.length > 80
        ? `${value.slice(0, 40)}… (${value.length} chars)`
        : value,
  );
}

export function registerTools(server: McpServer, caller: McpCaller, tools: Record<string, Tool>): void {
  for (const [name, def] of Object.entries(tools)) {
    if (def.write && !caller.canWrite) continue;
    server.registerTool(
      name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input,
        annotations: {
          title: def.title,
          readOnlyHint: !def.write,
          ...(def.write
            ? { destructiveHint: Boolean(def.destructive), idempotentHint: Boolean(def.idempotent) }
            : {}),
          openWorldHint: Boolean(def.openWorld),
        },
      },
      async (args: unknown) => {
        if (def.write) console.info(`[mcp] ${caller.email} (${caller.tokenPrefix}…) ${name} ${brief(args)}`);
        try {
          const data = await def.run(args, caller);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
            structuredContent: data,
          };
        } catch (err) {
          const known = err instanceof ToolError || err instanceof z.ZodError;
          if (!known) console.error(`[mcp] ${name} failed`, err);
          const text =
            err instanceof z.ZodError
              ? err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")
              : known
                ? (err as Error).message
                : `${name} failed inside Observator; the server log has the details.`;
          return { content: [{ type: "text" as const, text }], isError: true };
        }
      },
    );
  }
}

/** A project by slug (preferred) or exact name. */
export async function resolveProject(ref: string): Promise<ProjectRecord> {
  const bySlug = await getProjectBySlug(ref.trim());
  if (bySlug) return bySlug;
  const wanted = ref.trim().toLowerCase();
  const byName = (await listProjects()).filter((p) => p.name.toLowerCase() === wanted);
  if (byName.length === 1) return byName[0];
  throw new ToolError(
    byName.length > 1
      ? `Several projects are called "${ref}"; use the slug (list_projects shows it).`
      : `No project with slug or name "${ref}". list_projects shows the existing ones.`,
  );
}

export const projectUrl = (slug: string) => `${env().APP_URL}/projects/${slug}`;

/** A PocketBase date as ISO 8601, or null. */
export const iso = (value: string | null | undefined) => pbDate(value ?? "")?.toISOString() ?? null;

export const projectRef = z
  .string()
  .min(1)
  .max(200)
  .describe("The project's slug (from list_projects) or its exact name");
