// SPDX-License-Identifier: FSL-1.1-ALv2
import type { EventType } from "@/lib/issues/events";
import type { Severity } from "@/lib/pb/types";

export type MessageTone = Severity | "info" | "ok";

export interface MessageItem {
  severity?: Severity;
  title: string;
  detail?: string;
  url?: string;
}

export interface MessageAction {
  label: string;
  url: string;
}

/** Channel-neutral notification. Every driver formats this for its own service. */
export interface Message {
  event: EventType;
  tone: MessageTone;
  title: string;
  summary: string;
  items: MessageItem[];
  /** Items left out to keep the message short. */
  more: number;
  actions: MessageAction[];
}

export const MAX_ITEMS = 10;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text rendering, used by channels without rich formatting and as fallback. */
export function toPlainText(msg: Message): string {
  const lines = [msg.title, "", msg.summary];
  if (msg.items.length) lines.push("");
  for (const item of msg.items) {
    lines.push(
      `- ${item.severity ? `[${item.severity.toUpperCase()}] ` : ""}${item.title}${item.detail ? `: ${item.detail}` : ""}`,
    );
  }
  if (msg.more > 0) lines.push(`- ...and ${msg.more} more`);
  if (msg.actions.length) lines.push("", ...msg.actions.map((a) => `${a.label}: ${a.url}`));
  return lines.join("\n");
}

const mdEscape = (s: string) => s.replace(/([\\`*_[\]<>|~])/g, "\\$1");

/** CommonMark rendering for ntfy, Gotify, Apprise and Discord. */
export function toMarkdown(msg: Message, { links = true }: { links?: boolean } = {}): string {
  const lines = [mdEscape(msg.summary)];
  if (msg.items.length) lines.push("");
  for (const item of msg.items) {
    const sev = item.severity ? `**${item.severity.toUpperCase()}** ` : "";
    const title =
      item.url && links ? `[${mdEscape(item.title)}](${item.url})` : `**${mdEscape(item.title)}**`;
    lines.push(`- ${sev}${title}${item.detail ? `: ${mdEscape(item.detail)}` : ""}`);
  }
  if (msg.more > 0) lines.push(`- …and ${msg.more} more`);
  if (links && msg.actions.length)
    lines.push("", msg.actions.map((a) => `[${mdEscape(a.label)}](${a.url})`).join(" · "));
  return lines.join("\n");
}

export const TONE_COLOR: Record<MessageTone, string> = {
  critical: "#d92d20",
  high: "#e5483f",
  moderate: "#e8a317",
  low: "#8a8f98",
  unknown: "#8a8f98",
  info: "#5b6cf0",
  ok: "#1f9d61",
};
