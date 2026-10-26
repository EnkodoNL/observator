// SPDX-License-Identifier: FSL-1.1-ALv2
import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { McpCaller } from "@/lib/data/mcp-tokens";
import { installTools } from "./install";
import { readTools } from "./read-tools";
import { brief, registerTools } from "./tools";
import { writeTools } from "./write-tools";

const all = { ...readTools, ...writeTools, ...installTools };
const caller = (canWrite: boolean): McpCaller => ({
  tokenId: "t",
  tokenPrefix: "obsm_x",
  canWrite,
  lastUsedAt: "",
  userId: "u",
  email: "dev@example.com",
});

function registered(canWrite: boolean) {
  const names: string[] = [];
  const fake = { registerTool: (name: string) => names.push(name) } as unknown as McpServer;
  registerTools(fake, caller(canWrite), all);
  return names;
}

describe("MCP tools", () => {
  it("can create, read and update, never delete", () => {
    for (const [name, def] of Object.entries(all)) {
      expect(name).not.toMatch(/delete|remove|revoke|destroy|purge/);
      expect(def.description).not.toMatch(/\bdeletes?\b/i);
    }
  });

  it("marks every tool that changes something as a write tool", () => {
    for (const def of Object.values(readTools)) expect(def.write).toBeFalsy();
    for (const def of [...Object.values(writeTools), ...Object.values(installTools)])
      expect(def.write).toBe(true);
  });

  it("offers read-only tokens only the read tools", () => {
    expect(registered(false).sort()).toEqual(Object.keys(readTools).sort());
    expect(registered(true).sort()).toEqual(Object.keys(all).sort());
  });

  it("has input schemas that become JSON Schema objects", () => {
    for (const [name, def] of Object.entries(all)) {
      const schema = z.toJSONSchema(def.input, { io: "input" }) as { type?: string };
      expect(schema.type, name).toBe("object");
    }
  });

  it("keeps secrets and long text out of the log line", () => {
    const line = brief({
      project: "web",
      key: "obss_secret",
      config: { botToken: "123:abc" },
      deployWebhook: { url: "https://x", token: "hunter2" },
      dockerfile: "FROM node:24-alpine\n".repeat(20),
    });
    expect(line).not.toMatch(/obss_secret|123:abc|hunter2/);
    expect(line).toContain('"project":"web"');
    expect(line).toMatch(/\(400 chars\)/);
  });
});
