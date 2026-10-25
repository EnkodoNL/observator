// SPDX-License-Identifier: FSL-1.1-ALv2
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../message";
import { discord } from "./discord";
import { pushover } from "./pushover";
import { slack } from "./slack";
import { telegram } from "./telegram";

const msg: Message = {
  event: "vuln.new",
  tone: "critical",
  title: "2 new vulnerabilities in api",
  summary: "1 critical, 1 high. Upgrade to the fixed versions.",
  items: [
    {
      severity: "critical",
      title: "minimist@1.2.5",
      detail: "Prototype Pollution <script> · fixed in 1.2.6",
      url: "https://osv.dev/vulnerability/GHSA-xvch-5gv4-984h",
    },
    { severity: "high", title: "lodash@4.17.20", detail: "Command Injection & more" },
  ],
  more: 3,
  actions: [
    { label: "Open project", url: "http://localhost:3100/projects/api" },
    { label: "Redeploy", url: "http://localhost:3100/projects/api?redeploy=1" },
  ],
};

function capture(responses: (() => Response)[] = []) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
      return (responses.shift() ?? (() => new Response("ok")))();
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("slack", () => {
  it("sends Block Kit with escaped text and link buttons", async () => {
    const calls = capture();
    await slack.send(msg, { webhookUrl: "https://hooks.slack.com/services/T/B/X" });
    const body = calls[0].body as {
      text: string;
      blocks: { type: string; text?: { text: string }; elements?: { url: string }[] }[];
    };
    expect(body.blocks.map((b) => b.type)).toEqual(["header", "section", "section", "actions"]);
    expect(body.blocks[2].text?.text).toContain("&lt;script&gt;");
    expect(body.blocks[2].text?.text).toContain(
      "<https://osv.dev/vulnerability/GHSA-xvch-5gv4-984h|minimist@1.2.5>",
    );
    expect(body.blocks[2].text?.text).toContain("…and 3 more");
    expect(body.blocks[3].elements?.map((e) => e.url)).toHaveLength(2);
    expect(body.text.length).toBeLessThanOrEqual(3000);
  });
});

describe("telegram", () => {
  it("sends HTML with an inline keyboard", async () => {
    const calls = capture();
    await telegram.send(msg, { botToken: "123:abcdefghijklmnopqrstuvwxyz", chatId: "-100123" });
    expect(calls[0].url).toBe("https://api.telegram.org/bot123:abcdefghijklmnopqrstuvwxyz/sendMessage");
    const body = calls[0].body as {
      text: string;
      parse_mode: string;
      reply_markup: { inline_keyboard: { url: string }[][] };
    };
    expect(body.parse_mode).toBe("HTML");
    expect(body.text).toContain("<b>2 new vulnerabilities in api</b>");
    expect(body.text).toContain("&lt;script&gt;");
    expect(body.text).toContain("Command Injection &amp; more");
    expect(body.reply_markup.inline_keyboard[0]).toHaveLength(2);
  });

  it("falls back to links in the text when Telegram rejects button URLs", async () => {
    const calls = capture([
      () => new Response('{"ok":false,"description":"Bad Request: BUTTON_URL_INVALID"}', { status: 400 }),
    ]);
    await telegram.send(msg, { botToken: "123:abcdefghijklmnopqrstuvwxyz", chatId: "-100123" });
    expect(calls).toHaveLength(2);
    const retry = calls[1].body as { text: string; reply_markup?: unknown };
    expect(retry.reply_markup).toBeUndefined();
    expect(retry.text).toContain("Open project: http://localhost:3100/projects/api");
  });

  it("validates its config", () => {
    expect(telegram.schema.safeParse({ botToken: "nope", chatId: "x" }).success).toBe(false);
    expect(
      telegram.schema.safeParse({ botToken: "123456:AAbbCCddEEffGGhhIIjjKK", chatId: "-1001234" }).success,
    ).toBe(true);
  });
});

describe("discord", () => {
  it("sends one embed coloured by severity, without mentions", async () => {
    const calls = capture();
    await discord.send(msg, { webhookUrl: "https://discord.com/api/webhooks/1/x" });
    const body = calls[0].body as {
      allowed_mentions: unknown;
      embeds: { title: string; color: number; description: string; url: string }[];
    };
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0].color).toBe(0xd92d20);
    expect(body.embeds[0].url).toBe("http://localhost:3100/projects/api");
    expect(body.embeds[0].description.length).toBeLessThanOrEqual(4096);
  });
});

describe("pushover", () => {
  it("keeps the message within 1024 characters", async () => {
    const calls = capture();
    const long = {
      ...msg,
      items: Array.from({ length: 10 }, (_, i) => ({ title: `pkg${i}@1.0.0`, detail: "x".repeat(200) })),
    };
    await pushover.send(long, { userKey: "u", apiToken: "t" });
    const body = calls[0].body as { message: string; html: number; priority: number; url: string };
    expect(body.message.length).toBeLessThanOrEqual(1024);
    expect(body.html).toBe(1);
    expect(body.priority).toBe(1);
    expect(body.url).toBe("http://localhost:3100/projects/api");
  });
});
