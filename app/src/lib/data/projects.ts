// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { adminPb, isNotFound } from "@/lib/pb/admin";
import { newApiKey, randomToken, sha256 } from "@/lib/crypto";
import type { ProjectRecord } from "@/lib/pb/types";

export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project"
  );
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const pb = await adminPb();
  return pb.collection("projects").getFullList<ProjectRecord>({ sort: "name" });
}

export async function getProjectBySlug(slug: string): Promise<ProjectRecord | null> {
  const pb = await adminPb();
  try {
    return await pb
      .collection("projects")
      .getFirstListItem<ProjectRecord>(pb.filter("slug = {:slug}", { slug }));
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function getProjectByKey(key: string): Promise<ProjectRecord | null> {
  const pb = await adminPb();
  try {
    return await pb
      .collection("projects")
      .getFirstListItem<ProjectRecord>(pb.filter("apiKeyHash = {:hash}", { hash: sha256(key) }));
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function uniqueSlug(base: string): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    if (!(await getProjectBySlug(slug))) return slug;
  }
  return `${base}-${randomToken(3)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")}`;
}

/** Creates a project and returns it together with the plain API key (shown once). */
export async function createProject(name: string): Promise<{ project: ProjectRecord; apiKey: string }> {
  const pb = await adminPb();
  const { key, hash, prefix } = newApiKey();
  const project = await pb.collection("projects").create<ProjectRecord>({
    name,
    slug: await uniqueSlug(slugify(name)),
    apiKeyHash: hash,
    apiKeyPrefix: prefix,
    badgeToken: randomToken(18),
  });
  return { project, apiKey: key };
}

export async function rotateApiKey(projectId: string): Promise<string> {
  const pb = await adminPb();
  const { key, hash, prefix } = newApiKey();
  await pb.collection("projects").update(projectId, { apiKeyHash: hash, apiKeyPrefix: prefix });
  return key;
}

export async function updateProject(
  projectId: string,
  data: Partial<
    Pick<ProjectRecord, "name" | "deployWebhookUrl" | "deployWebhookMethod" | "deployWebhookToken">
  >,
): Promise<ProjectRecord> {
  const pb = await adminPb();
  return pb.collection("projects").update<ProjectRecord>(projectId, data);
}

export async function deleteProject(projectId: string): Promise<void> {
  const pb = await adminPb();
  await pb.collection("projects").delete(projectId);
}
