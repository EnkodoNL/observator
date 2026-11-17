// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import type { ImageInventory } from "@/lib/images/describe";
import type { Component } from "@/lib/lockfile/types";
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
  /** Apps in the images, by their GitHub repository. Absent in inventories from before. */
  apps?: AppInventory[];
  /** Coolify's own scan of what runs. Absent before, null without one. */
  scan?: ScanSummary | null;
  /** The packages recorded: the apps and the fixable findings of the scan. */
  components?: Component[];
  /** When the images of a service could not be listed. */
  error: string | null;
  syncedAt: string;
}

/** An app in a service's image, known by its GitHub repository. */
export interface AppInventory {
  part: string;
  /** owner/repo */
  source: string;
  /** The version checked: the tag's, or for a moving tag the newest release in its line. */
  version: string | null;
  /** For a moving tag: the version is the newest release in its line, not read from what runs. */
  assumed: boolean;
  /** The newest stable release on GitHub, for showing. */
  latest: string | null;
  /** Advisories whose range could not be read: to check by hand. */
  unclear: string[];
  error: string | null;
}

/** Coolify's image scan of a resource, as far as Observator uses it. */
export interface ScanSummary {
  /** Findings with a fix: these are the advisories. */
  fixable: number;
  /** Findings without one: counted only. */
  unfixable: number;
  /** Why there is no scan (scanning off, an older Coolify). */
  off: string | null;
  scannedAt: string | null;
  error: string | null;
}

/** Per server: when it was synced, how many of each, and why not. */
export interface ResourceSyncStatus {
  at: string;
  databases: number | null;
  services: number | null;
  error: string | null;
  /** Resources with a scan by Coolify, and without one (scanning off, an older Coolify). */
  scanned?: number;
  scanOff?: number;
}

export const inventoryKey = (projectId: string) => `coolify:resource:${projectId}`;
export const syncStatusKey = (serverId: string) => `coolify:sync:${serverId}`;

export const resourceInventory = (projectId: string) => kvGet<ResourceInventory>(inventoryKey(projectId));
export const resourceSyncStatus = (serverId: string) => kvGet<ResourceSyncStatus>(syncStatusKey(serverId));
