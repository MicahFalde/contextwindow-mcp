import { test } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import packageJson from "../package.json" with { type: "json" };

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRY = `${ROOT}src/index.mjs`;
const TWO_SECONDS = 2000;
// The three request objects, in the order they are written.
const initializeParams = () => ({
  protocolVersion: "2025-06-18",
  capabilities: { roots: {} },
  clientInfo: { name: "node-test", version: "1.0" },
});

// The scratch folders hang off the os temp dir, never off the repo.
const EMPTY_BIN = mkdtempSync(`${tmpdir()}/empty-bin-`);

// One line-delimited JSON-RPC exchange with the shipped entry point, timed from the first
// write. The empty directory as PATH is what keeps the run offline: neither `gh` nor a DNS
// lookup is reachable, so an answer can only come off the in-memory registry (MCP-NFR-001).
function stdioSession() {
  const child = spawn(process.execPath, [ENTRY], { env: { PATH: EMPTY_BIN } });

  const lines = [];
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    for (const part of chunk.split("\n")) {
      if (!part.trim()) continue;
      const message = JSON.parse(part);
      const settle = pending.get(message.id);
      if (settle) {
        pending.delete(message.id);
        settle(message);
      }
    }
  });

  // One promise per request id, so a later request cannot be answered off an earlier line.
  const send = (payload) => {
    const result = new Promise((resolve) => pending.set(payload.id, resolve));
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return result;
  };

  const run = async () => {
    const started = Date.now();
    await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams() });
    const toolsAt = Date.now();
    const tools = await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const prompts = await send({ jsonrpc: "2.0", id: 3, method: "prompts/list", params: {} });

    return {
      // The two-second budget is the round trip to the tool listing (MCP-NFR-001).
      elapsed: toolsAt - started,
      tools: tools.result?.tools ?? [],
      prompts: prompts.result?.prompts ?? [],
    };
  };

  return run().finally(() => {
    child.stdin.end();
    child.unref();
  });
}

test("MCP-NFR-001 the shipped server answers tools/list with six tools within two seconds", async () => {
  const { elapsed, tools } = await stdioSession();

  assert.equal(elapsed < TWO_SECONDS, true, `answered in ${elapsed} ms`);

  assert.deepEqual(
    tools.map((t) => t.name),
    ["add_agenda_item", "list_agenda", "share_project", "get_projects", "pull_share", "log_recap"],
  );
  for (const tool of tools) assert.equal(typeof tool.description, "string", tool.name);
});

test("MCP-NFR-001 prompts/list comes back with the two slash commands", async () => {
  const { prompts } = await stdioSession();
  assert.deepEqual(
    prompts.map((p) => p.name),
    ["prep", "brief"],
  );
});

// The dependency set is read straight off package.json rather than restated here.
// MCP-NFR-002
test("MCP-NFR-002 the runtime dependency list is exactly the sdk and zod", () => {
  assert.deepEqual(Object.keys(packageJson.dependencies), ["@modelcontextprotocol/sdk", "zod"]);
});

test("MCP-NFR-001 the entry point is executable and carries the node shebang", () => {
  const source = readFileSync(ENTRY, "utf8");
  assert.equal(source.split("\n")[0], "#!/usr/bin/env node");
});
