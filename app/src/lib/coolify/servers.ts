// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { z } from "zod";
import { adminPb } from "@/lib/pb/admin";
import type { CoolifyServerRecord } from "@/lib/pb/types";
import { SecretsKeyError, seal, unseal } from "@/lib/secrets";
import { coolifyBase, listApplications } from "./client";

/** Context the token is encrypted under, see lib/secrets. */
export const SERVER_TOKEN = "coolify_servers.token";

export const coolifyServerSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Give the server a name").max(100),
  url: z
    .string()
    .trim()
    .refine((v) => coolifyBase(v) !== null, "Enter the Coolify URL, such as https://coolify.example.com"),
  /** Empty keeps the stored token: the browser never sees it. */
  token: z.string().trim().max(2000),
});
export type CoolifyServerInput = z.infer<typeof coolifyServerSchema>;

export interface CoolifyServerView {
  id: string;
  name: string;
  url: string;
  hasToken: boolean;
}

export const toServerView = (s: CoolifyServerRecord): CoolifyServerView => ({
  id: s.id,
  name: s.name,
  url: s.url,
  hasToken: Boolean(s.token),
});

export async function listServers(): Promise<CoolifyServerRecord[]> {
  const pb = await adminPb();
  return pb.collection("coolify_servers").getFullList<CoolifyServerRecord>({ sort: "name" });
}

/** The server's base URL and token, or null when the token cannot be opened. */
export function serverAccess(server: CoolifyServerRecord): { base: string; token: string } | null {
  try {
    const token = unseal(server.token, SERVER_TOKEN);
    return token ? { base: server.url, token } : null;
  } catch (err) {
    if (err instanceof SecretsKeyError) return null;
    throw err;
  }
}

/**
 * Saves a server. An empty token keeps the stored one, unless the URL moved to another host: a
 * token never travels to a host it was not meant for.
 */
export async function saveServer(raw: unknown): Promise<CoolifyServerRecord> {
  const input = coolifyServerSchema.parse(raw);
  const pb = await adminPb();
  const url = coolifyBase(input.url)!;
  const data: Partial<CoolifyServerRecord> = { name: input.name, url };
  if (input.token) data.token = seal(input.token, SERVER_TOKEN);
  if (!input.id) return pb.collection("coolify_servers").create<CoolifyServerRecord>(data);
  const previous = await pb.collection("coolify_servers").getOne<CoolifyServerRecord>(input.id);
  if (!input.token && new URL(previous.url).origin !== new URL(url).origin) data.token = "";
  return pb.collection("coolify_servers").update<CoolifyServerRecord>(input.id, data);
}

/** Removes a server; projects linked through it keep their application, unlinked from a server. */
export async function deleteServer(id: string): Promise<void> {
  const pb = await adminPb();
  const linked = await pb
    .collection("projects")
    .getFullList({ filter: pb.filter("coolifyServer = {:id}", { id }), fields: "id" });
  for (const p of linked) await pb.collection("projects").update(p.id, { coolifyServer: "" });
  await pb.collection("coolify_servers").delete(id);
}

/** How many applications the token can read, or why not: what "Test" shows. */
export async function testServer(server: { base: string; token: string }): Promise<string> {
  const apps = await listApplications(server);
  if ("error" in apps) return apps.error;
  return `Connected: the token can read ${apps.length} application${apps.length === 1 ? "" : "s"}.`;
}
