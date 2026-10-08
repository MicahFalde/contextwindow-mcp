import { test } from "node:test";
import assert from "node:assert";

import { registerTools, makeDeps } from "../src/tools.mjs";
import { FakeRepo } from "./helpers/fakeRepo.mjs";

const TOKEN = "ghp_" + "a".repeat(36);

// A capture object with the same four fields the real McpServer exposes is enough to read
// back what got registered, so the suite needs no transport.
function captured() {
  const registry = { _registeredTools: {}, _registeredPrompts: {} };
  registry.registerTool = (name, config, handler) => {
    registry._registeredTools[name] = { ...config, handler };
  };
  registry.registerPrompt = (name, config, handler) => {
    registry._registeredPrompts[name] = { ...config, handler };
  };
  registerTools(registry, fakeDeps());
  return registry;
}

const TOOL_NAMES = [
  "add_agenda_item",
  "list_agenda",
  "share_project",
  "get_projects",
  "pull_share",
  "log_recap",
];

function fakeDeps(overrides = {}) {
  return {
    getToken: async () => TOKEN,
    getLogin: async () => "micah",
    getRepo: async () => overrides.repo ?? new FakeRepo({ "config.json": "{}" }),
    ...overrides,
  };
}

// The stamp the fixture instants are read at, so a path suffix can be spelled out once.
const STAMP = new Date("2026-10-08T14:00:00Z");
test("MCP-SHARE-004 six tools are registered, each with a description and an input schema", () => {
  const registry = captured();
  assert.deepEqual(Object.keys(registry._registeredTools), TOOL_NAMES);
  for (const name of TOOL_NAMES) {
    const tool = registry._registeredTools[name];
    assert.equal(typeof tool.description, "string", `${name} has a description`);
    assert.ok(tool.description.length > 0);
    assert.equal(typeof tool.inputSchema, "object", `${name} has an input schema`);
    assert.equal(typeof tool.handler, "function");
  }
});

// The one sentence has to be present in both writer descriptions, verbatim.
test("MCP-SHARE-004 both writers state that files attach only on an explicit ask", () => {
  const { _registeredTools: tools } = captured();
  const sentence = "Attach files only when the member explicitly asks to share code.";
  for (const name of ["add_agenda_item", "share_project"]) {
    assert.equal(tools[name].description.includes(sentence), true, name);
  }
});

// MCP-SHARE-004 pairs that sentence with the repo_url route for anything larger.
test("MCP-SHARE-004 both writer descriptions name repo_url and the three limit numbers", () => {
  const { _registeredTools: tools } = captured();
  for (const name of ["add_agenda_item", "share_project"]) {
    const d = tools[name].description;
    assert.match(d, /repo_url/, name);
    assert.match(d, /25 files per share/, name);
    assert.match(d, /256000 bytes per file/, name);
    assert.match(d, /2097152 bytes in total/, name);
  }
});

test("MCP-SHARE-004 the input schemas carry the contract's parameter names", () => {
  const { _registeredTools: tools } = captured();
  assert.deepEqual(Object.keys(tools.add_agenda_item.inputSchema), [
    "title",
    "note",
    "link",
    "call_date",
    "files",
    "repo_url",
  ]);
  assert.deepEqual(Object.keys(tools.share_project.inputSchema), [
    "name",
    "status",
    "summary",
    "links",
    "files",
    "repo_url",
  ]);
  assert.deepEqual(Object.keys(tools.get_projects.inputSchema), ["author", "query"]);
  assert.deepEqual(Object.keys(tools.list_agenda.inputSchema), ["week"]);
  assert.deepEqual(Object.keys(tools.pull_share.inputSchema), ["share_id"]);
  assert.deepEqual(Object.keys(tools.log_recap.inputSchema), ["call_date", "recap"]);
});

test("MCP-AGENDA-001 a handler returns the written path as one text block", async () => {
  const { _registeredTools: tools } = captured();
  const repo = new FakeRepo({});
  const stamp = new Date("2026-10-08T14:00:00Z");
  const out = await tools.add_agenda_item.handler(
    { title: "Alpha", note: "Note.", call_date: "2026-10-07" },
    fakeDeps({ repo }),
  );

  assert.ok(out.content, "one result object comes back");
  assert.equal(out.isError ?? false, false);
  assert.equal(out.content.length, 1);
  assert.equal(out.content[0].type, "text");
  const payload = JSON.parse(out.content[0].text);
  assert.equal(payload.call_date, "2026-10-07");
  assert.equal(payload.share, null);
  assert.match(payload.path, /^agenda\/2026-10-07\/alpha-[0-9a-z]{4}\.md$/);
  assert.equal(payload.path.startsWith("agenda/2026-10-07/alpha-"), true);
  assert.equal(repo.writes.length, 1);
  assert.equal(repo.writes[0].path, payload.path);
  assert.match(repo.writes[0].text, /^---\ntitle: Alpha\nauthor: micah\nadded: .*Z\n---\nNote\.$/s);
});

// The handlers are built over one bag so the shipped token source order is what runs.
test("MCP-AUTH-002 a missing token becomes an isError result naming both sources, with no network", async () => {
  const { _registeredTools: tools } = captured();
  const seen = [];
  const bag = makeDeps({});
  // The shipped token getter answers the missing-token case; the counting fake below stands
  // in for the module-level fetch so the request count is observable.
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => (seen.push(url), { status: 200, json: async () => ({}) });
  let out;
  try {
    out = await tools.list_agenda.handler({ week: "2026-10-07" }, { ...bag, getRepo: async () => null });
  } finally {
    globalThis.fetch = saved;
  }
  assert.equal(out.isError, true);
  assert.equal(out.content[0].text.includes("GITHUB_TOKEN"), true);
  assert.equal(out.content[0].text.includes("gh auth token"), true);
  assert.deepEqual(seen, [], "the token check answers before any request goes out");
});

test("MCP-SHARE-002 a limit breach is an isError result whose text names the limit", async () => {
  const { _registeredTools: tools } = captured();
  const files = Array.from({ length: 26 }, (_, i) => ({ path: `f${i}`, content: "x" }));
  const out = await tools.add_agenda_item.handler({ title: "A", files }, fakeDeps());
  assert.equal(out.isError, true);
  assert.equal(out.content[0].text, "too many files: 26 > 25 files per share");
});

// The scan reports pointers, so the values must not appear anywhere in the result.
test("MCP-SCAN-002 an error result carries pointers and no secret values", async () => {
  const { _registeredTools: tools } = captured();
  const secret = "ABCDEFGHIJKLmnopqrst01345678";
  const out = await tools.share_project.handler(
    { name: "A", files: [{ path: "src/a.mjs", content: `MY_KEY=${secret}` }] },
    fakeDeps(),
  );
  assert.equal(out.isError, true);
  const joined = JSON.stringify(out);
  assert.equal(joined.includes(secret), false, "the matched value is not echoed");
  assert.match(out.content[0].text, /src\/a\.mjs:1 high-entropy-assignment/);
});

test("MCP-SHARE-004 the two writer descriptions differ only in their lead line", () => {
  const { _registeredTools: tools } = captured();
  const tail = (d) => d.slice(d.indexOf("Attach files"));
  assert.equal(tail(tools.add_agenda_item.description), tail(tools.share_project.description));
});

test("MCP-NFR-001 the deps getters are the only thing that can touch the network", async () => {
  const seen = [];
  const fetch = async (url) => (seen.push(url), { status: 200, json: async () => ({ login: "micah" }) });
  const saved = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const deps = makeDeps({ GITHUB_TOKEN: TOKEN });
    assert.deepEqual(seen, [], "construction alone makes no call");
    assert.equal(await deps.getToken(), TOKEN);
    assert.equal(await deps.getLogin(), "micah");
    assert.deepEqual(seen, ["https://api.github.com/user"]);
    assert.equal((await deps.getRepo()).repo, "MicahFalde/contextwindow");
    assert.equal(seen.length, 1, "the token and login are each resolved once");
  } finally {
    globalThis.fetch = saved;
  }
});

test("MCP-GIT-004 the deps client honours CONTEXTWINDOW_REPO", async () => {
  const deps = makeDeps({ GITHUB_TOKEN: TOKEN, CONTEXTWINDOW_REPO: "Someone/else" });
  assert.equal((await deps.getRepo()).repo, "Someone/else");
});
