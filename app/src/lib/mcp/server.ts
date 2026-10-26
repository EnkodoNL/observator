// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import type { McpCaller } from "@/lib/data/mcp-tokens";
import { VERSION } from "@/lib/version";
import { installTools, registerInstallPrompt } from "./install";
import { readTools } from "./read-tools";
import { registerTools } from "./tools";
import { writeTools } from "./write-tools";

const INSTRUCTIONS = `Observator tracks the Node version and npm packages that self-hosted Node apps really run. Each app reports from a stage in its Dockerfile during docker build; Observator checks the Node version against nodejs.org and every package against OSV, and notifies when something needs doing.

- A project is one app (or one server of an app, when a shared key splits by IP). Status: ok, update (a Node security release or end of life), vulnerable (open package advisories), none (no build yet).
- Start with list_projects; get_project has the details and fix advice in the project's package manager; list_packages and get_package answer "where is X used"; node_overview groups projects by Node version.
- Labels (word or key:value such as app:heatwave, env:prod) group and filter projects. Builds add their own via OBSERVATOR_LABELS; update_project sets the project's own.
- To add Observator to a repository, use setup_dockerfile per Dockerfile (the install prompt has the steps) and write the returned Dockerfile back unchanged.
- Nothing can be deleted through MCP, and users, tokens and sign-in are out of reach; those stay in the web UI.`;

/** One server per request: tools for writing only exist for tokens that may write. */
export function buildServer(caller: McpCaller): McpServer {
  const server = new McpServer({ name: "observator", version: VERSION }, { instructions: INSTRUCTIONS });
  registerTools(server, caller, { ...readTools, ...writeTools, ...installTools });
  if (caller.canWrite) registerInstallPrompt(server);
  return server;
}

const g = globalThis as typeof globalThis & { __mcpHandler?: McpHttpHandler };

/**
 * Serves both protocol generations: 2026-07-28 (stateless, per request) and 2025-era clients
 * through the SDK's stateless fallback. JSON responses only: no tool streams progress.
 */
export function mcpHandler(): McpHttpHandler {
  return (g.__mcpHandler ??= createMcpHandler(
    (ctx) => {
      const caller = ctx.authInfo?.extra?.caller as McpCaller | undefined;
      // The route only gets here with a verified token; anything else is a bug.
      if (!caller) throw new Error("MCP request without a verified caller");
      return buildServer(caller);
    },
    {
      legacy: "stateless",
      responseMode: "json",
      onerror: (err) => console.error("[mcp]", err.message),
    },
  ));
}
