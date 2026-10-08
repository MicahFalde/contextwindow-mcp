import { test } from "node:test";
import assert from "node:assert";

import { shareProject, getProjects, parseFrontmatter } from "../src/store.mjs";
import { FakeRepo } from "./helpers/fakeRepo.mjs";

const NOW = new Date("2026-10-07T13:00:00Z");
const PATH = "projects/micah/context-window-mcp.md";

const base = () => ({
  name: "Context Window MCP",
  status: "in progress",
  summary: "Stdio server over the data repo.",
  links: ["https://example.com/mcp"],
});

test("MCP-PROJ-001 the project file carries its five frontmatter keys and the summary as body", async () => {
  const repo = new FakeRepo({ "config.json": "{}" });
  const out = await shareProject({ repo, login: "micah", now: NOW, ...base() });

  assert.equal(out.path, PATH);
  const { data, body } = parseFrontmatter(repo.writes[0].text);
  assert.deepEqual(data, {
    name: "Context Window MCP",
    status: "in progress",
    author: "micah",
    updated: "2026-10-07T13:00:00.000Z",
    links: ["https://example.com/mcp"],
  });
  assert.equal(body.trim(), "Stdio server over the data repo.");
  assert.equal(repo.writes[0].message, "share_project: Context Window MCP");
});

// The upsert only works while the path repeats, so the id has to be the base slug.
test("MCP-PROJ-001 a re-share replaces the same file instead of adding a second one", async () => {
  const repo = new FakeRepo({ "config.json": "{}" });
  const first = await shareProject({ repo, login: "micah", now: NOW, ...base() });
  const second = await shareProject({
    repo,
    login: "micah",
    now: new Date("2026-10-08T13:00:00Z"),
    ...base(),
    status: "shipped",
  });

  assert.equal(first.path, second.path);
  assert.equal(repo.files.get(PATH).includes("updated: 2026-10-08T13:00:00.000Z"), true);
  assert.equal(repo.files.get(PATH).includes("status: shipped"), true);
  assert.equal(repo.files.get(PATH).includes("in progress"), false, "the old value is gone");
  assert.equal((await repo.listTree()).filter((e) => e.path === PATH).length, 1);
});

test("MCP-PROJ-001 one file per project, one folder per member", async () => {
  const repo = new FakeRepo({ "config.json": "{}" });
  await shareProject({ repo, login: "micah", now: NOW, name: "Context Window MCP", summary: "A" });
  await shareProject({ repo, login: "micah", now: NOW, name: "Jarvis Box", summary: "B" });
  await shareProject({ repo, login: "other", now: NOW, name: "Context Window MCP", summary: "C" });

  assert.deepEqual(repo.paths(), [
    PATH,
    "projects/micah/jarvis-box.md",
    "projects/other/context-window-mcp.md",
  ]);
});

test("MCP-PROJ-002 every project comes back with exactly the five fields", async () => {
  const repo = new FakeRepo({
    "config.json": "{}",
    [PATH]: [
      "---",
      "name: Context Window MCP",
      "status: in progress",
      "author: micah",
      "updated: 2026-10-07T13:00:00.000Z",
      "links: [\"https://example.com/mcp\"]",
      "share: 20261007-micah-7j40",
      "files: [\"src/a.mjs\"]",
      "---",
      "Stdio server over the data repo.",
    ].join("\n"),
    "projects/other/jarvis-box.md":
      "---\nname: Jarvis Box\nstatus: planned\nauthor: other\nupdated: 2026-10-06T13:00:00.000Z\n---\nWiring.",
    "shares/20261007-micah-7j40/src/a.mjs": "export const a = 1;\n",
    "README.md": "# Data repo\n",
  });

  const projects = await getProjects({ repo });
  assert.equal(projects.length, 2);
  for (const p of projects) assert.deepEqual(Object.keys(p), ["name", "author", "status", "updated", "summary"]);
  assert.deepEqual(projects[0], {
    name: "Context Window MCP",
    author: "micah",
    status: "in progress",
    updated: "2026-10-07T13:00:00.000Z",
    summary: "Stdio server over the data repo.",
  });
});

test("MCP-PROJ-002 the folder name covers a file whose frontmatter omits the author", async () => {
  const repo = new FakeRepo({ "projects/other/jarvis-box.md": "---\nname: Jarvis Box\n---\nWiring." });
  assert.equal((await getProjects({ repo }))[0].author, "other");
});

test("MCP-PROJ-003 author narrows to that login", async () => {
  const repo = repoWithTwo();
  const only = await getProjects({ repo, author: "other" });
  assert.deepEqual(only.map((p) => p.name), ["Jarvis Box"]);
});

test("MCP-PROJ-003 query matches name or summary, case-insensitively", async () => {
  const byName = await getProjects({ repo: repoWithTwo(), query: "JARVIS" });
  assert.deepEqual(byName.map((p) => p.name), ["Jarvis Box"]);
  const bySummary = await getProjects({ repo: repoWithTwo(), query: "stdio server" });
  assert.deepEqual(bySummary.map((p) => p.name), ["Context Window MCP"]);
});

test("MCP-PROJ-003 both filters together, and no match is an empty screen", async () => {
  assert.deepEqual(await getProjects({ repo: repoWithTwo(), author: "micah", query: "jarvis" }), []);
  assert.deepEqual(await getProjects({ repo: repoWithTwo(), author: "micah", query: "mcp" }), [
    {
      name: "Context Window MCP",
      author: "micah",
      status: "in progress",
      updated: "2026-10-07T13:00:00.000Z",
      summary: "Stdio server over the data repo.",
    },
  ]);
  assert.deepEqual(await getProjects({ repo: new FakeRepo({}) }), []);
});

test("MCP-SHARE-001 the attached files ride under the share id and are named in frontmatter", async () => {
  const repo = new FakeRepo({ "config.json": "{}" });
  const out = await shareProject({
    repo,
    login: "micah",
    now: NOW,
    ...base(),
    files: [
      { path: "src/a.mjs", content: "export const a = 1;\n" },
      { path: "src/nested/deep.json", content: '{"a":1}' },
    ],
    repo_url: "https://github.com/MicahFalde/contextwindow-mcp",
  });

  assert.match(out.share, /^20261007-micah-[0-9a-z]{4}$/);
  assert.deepEqual(repo.paths(), [
    `shares/${out.share}/src/a.mjs`,
    `shares/${out.share}/src/nested/deep.json`,
    PATH,
  ]);

  const { data } = parseFrontmatter(repo.writes.at(-1).text);
  assert.deepEqual(data.files, ["src/a.mjs", "src/nested/deep.json"]);
  assert.equal(data.share, out.share);
  assert.equal(data.repo_url, "https://github.com/MicahFalde/contextwindow-mcp");
});

test("MCP-SHARE-001 no files means no share key and no share writes", async () => {
  const repo = new FakeRepo({ "config.json": "{}" });
  const out = await shareProject({ repo, login: "micah", now: NOW, ...base() });
  assert.equal(out.share, null);
  assert.deepEqual(repo.paths(), [PATH]);
  assert.equal(repo.writes[0].text.includes("share:"), false);
});

test("MCP-SHARE-002 the three share limits each reject the whole share", async () => {
  const tooMany = Array.from({ length: 26 }, (_, i) => ({ path: `f${i}`, content: "x" }));
  await assert.rejects(
    () => shareProject({ repo: new FakeRepo({}), login: "micah", now: NOW, name: "A", files: tooMany }),
    (e) => /too many files: 26 > 25 files per share/.test(e.message),
  );

  const bigFile = [{ path: "big.json", content: "a".repeat(250 * 1024 + 1) }];
  await assert.rejects(
    () => shareProject({ repo: new FakeRepo({}), login: "micah", now: NOW, name: "A", files: bigFile }),
    (e) => /file too large: big\.json is 256001 bytes > 256000 bytes per file/.test(e.message),
  );

  const each = 90 * 1024;
  const many = Array.from({ length: 25 }, (_, i) => ({ path: `f${i}`, content: "a".repeat(each) }));
  await assert.rejects(
    () => shareProject({ repo: new FakeRepo({}), login: "micah", now: NOW, name: "A", files: many }),
    (e) => /share too large: 2304000 bytes > 2097152 bytes total/.test(e.message),
  );
});

test("MCP-SHARE-005 the path gate rejects dotted, absolute and dotenv names", async () => {
  for (const [path, fragment] of [
    ["src/../a.mjs", 'path contains "\\.\\."'],
    ["/abs/a.mjs", 'path starts with "/"'],
    ["dir/.env", "basename is a dotenv file"],
    ["dir/.env.local", "basename is a dotenv file"],
  ]) {
    const repo = new FakeRepo({});
    await assert.rejects(
      () => shareProject({ repo, login: "micah", now: NOW, name: "A", files: [{ path, content: "x" }] }),
      (e) => e.message.includes(fragment.replace("\\", "")) || new RegExp(fragment).test(e.message),
    );
    assert.equal(repo.writes.length, 0, `${path} wrote nothing`);
  }
});

test("MCP-SCAN-002 a secret in an attached file blocks the project write as well", async () => {
  const repo = new FakeRepo({});
  await assert.rejects(
    () =>
      shareProject({
        repo,
        login: "micah",
        now: NOW,
        name: "A",
        summary: "plain",
        files: [{ path: "src/a.mjs", content: 'MY_KEY=ABCDEFGHIJKLmnopqrst01345678' }],
      }),
    (e) => /Secret scan rejected the write/.test(e.message) && /src\/a\.mjs:1 high-entropy-assignment/.test(e.message),
  );
  assert.equal(repo.writes.length, 0);
});

function repoWithTwo() {
  return new FakeRepo({
    [PATH]:
      "---\nname: Context Window MCP\nstatus: in progress\nauthor: micah\nupdated: 2026-10-07T13:00:00.000Z\n---\nStdio server over the data repo.",
    "projects/other/jarvis-box.md":
      "---\nname: Jarvis Box\nstatus: planned\nauthor: other\nupdated: 2026-10-06T13:00:00.000Z\n---\nWiring.",
    "README.md": "# Data repo\n",
  });
}
