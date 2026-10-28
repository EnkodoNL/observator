// SPDX-License-Identifier: FSL-1.1-ALv2
import type { z } from "zod";
import { checkOutbound, isRedirect, OutboundError, showsReplies } from "@/lib/outbound";
import type { ChannelType } from "@/lib/pb/types";
import type { Message } from "../message";

export interface FieldMeta {
  name: string;
  label: string;
  kind: "text" | "url" | "password" | "email";
  placeholder?: string;
  help?: string;
  required?: boolean;
  /** Stored server-side only; never sent back to the browser. */
  secret?: boolean;
}

/** Serializable part of a driver, passed to the settings form. */
export interface ChannelMeta {
  type: ChannelType;
  label: string;
  description: string;
  help?: string[];
  fields: FieldMeta[];
}

export interface ChannelDriver<C = Record<string, string>> extends ChannelMeta {
  schema: z.ZodType<C>;
  send(msg: Message, config: C): Promise<void>;
}

export class SendError extends Error {}

/** fetch() reports "fetch failed"; the useful part (ECONNREFUSED, ENOTFOUND, ...) is in cause. */
export function describeFetchError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error && err.name === "TimeoutError") return `timed out after ${timeoutMs / 1000}s`;
  const cause =
    err instanceof Error ? (err.cause as { code?: string; message?: string } | undefined) : undefined;
  if (cause?.code)
    return `${cause.code}${cause.message && !cause.message.includes(cause.code) ? ` (${cause.message})` : ""}`;
  if (cause?.message) return cause.message;
  return err instanceof Error ? err.message : String(err);
}

/**
 * POST with a timeout; turns non-2xx responses into a readable error. The URL passes the outbound
 * guard first and redirects are not followed, so a channel cannot be pointed at the container,
 * cloud metadata or PocketBase, directly or through a redirect.
 */
export async function request(
  url: string,
  init: RequestInit & { json?: unknown } = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const { json, headers, ...rest } = init;
  let target: URL;
  try {
    target = await checkOutbound(url);
  } catch (err) {
    if (err instanceof OutboundError) throw new SendError(`refused: ${err.message}`);
    throw err;
  }
  let res: Response;
  try {
    res = await fetch(target.href, {
      method: "POST",
      redirect: "manual",
      ...rest,
      headers: {
        "user-agent": "observator",
        ...(json !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new SendError(`request failed: ${describeFetchError(err, timeoutMs)}`);
  }
  if (isRedirect(res.status)) throw new SendError(`HTTP ${res.status}: redirects are not followed`);
  if (!res.ok) {
    const body = showsReplies(target) ? (await res.text().catch(() => "")).slice(0, 300) : "";
    throw new SendError(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res;
}
