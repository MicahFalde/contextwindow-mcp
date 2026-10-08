#!/usr/bin/env node
// The stdio entry point. Registration is synchronous and needs no transport, so `tools/list`
// answers off the in-memory registry before any token is looked up — the deferred getters in
// makeDeps are what keep the start offline (MCP-NFR-001).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools, makeDeps } from "./tools.mjs";
import { registerPrompts } from "./prompts.mjs";

const SERVER_INFO = { name: "contextwindow", version: "0.1.0" };
const CAPABILITIES = {
  tools: { listChanged: true },
  prompts: { listChanged: true },
};

/** Build the server with its six tools and two prompts already registered.
 *
 *  MCP-NFR-001 */
export function createServer(env = process.env) {
  const server = new McpServer(SERVER_INFO, { capabilities: CAPABILITIES });
  registerTools(server, makeDeps(env));
  registerPrompts(server);
  return server;
}

const server = createServer();
await server.connect(new StdioServerTransport());
