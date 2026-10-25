// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import type { ChannelType } from "@/lib/pb/types";
import { apprise } from "./apprise";
import { discord } from "./discord";
import { email } from "./email";
import { gotify } from "./gotify";
import { ntfy } from "./ntfy";
import { pushover } from "./pushover";
import { slack } from "./slack";
import { telegram } from "./telegram";
import type { ChannelDriver, ChannelMeta } from "./types";
import { webhook } from "./webhook";

/** Adding a channel: write one driver file and register it here. */
export const DRIVERS: Record<ChannelType, ChannelDriver<never>> = {
  slack,
  telegram,
  discord,
  email,
  ntfy,
  gotify,
  pushover,
  apprise,
  webhook,
} as Record<ChannelType, ChannelDriver<never>>;

export function driverFor(type: ChannelType): ChannelDriver<Record<string, string>> {
  return DRIVERS[type] as unknown as ChannelDriver<Record<string, string>>;
}

export function channelMetas(): ChannelMeta[] {
  return Object.values(DRIVERS).map(({ type, label, description, help, fields }) => ({
    type,
    label,
    description,
    help,
    fields,
  }));
}

export function secretFields(type: ChannelType): string[] {
  return DRIVERS[type].fields.filter((f) => f.secret).map((f) => f.name);
}
