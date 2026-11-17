// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import type { ImageInventory } from "@/lib/images/describe";
import { kvGet } from "@/lib/kv";

/* What the Coolify sync keeps per database or service, apart from the sync so issues can read it. */

export type ResourceKind = "database" | "service";

/** What a database or service runs, kept per project for its page and MCP. */
export interface ResourceInventory {
  kind: ResourceKind;
  /** The Coolify server's name in Observator. */
  server: string;
  /** "mariadb" for a database, Coolify's service type ("umami") for a service. */
  type: string;
  images: (ImageInventory & { part: string })[];
  /** When the images of a service could not be listed. */
  error: string | null;
  syncedAt: string;
}

/** Per server: when it was synced, how many of each, and why not. */
export interface ResourceSyncStatus {
  at: string;
  databases: number | null;
  services: number | null;
  error: string | null;
}

export const inventoryKey = (projectId: string) => `coolify:resource:${projectId}`;
export const syncStatusKey = (serverId: string) => `coolify:sync:${serverId}`;

export const resourceInventory = (projectId: string) => kvGet<ResourceInventory>(inventoryKey(projectId));
export const resourceSyncStatus = (serverId: string) => kvGet<ResourceSyncStatus>(syncStatusKey(serverId));
