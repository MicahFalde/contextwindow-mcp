import { test } from "node:test";
import assert from "node:assert";

import { addAgendaItem, listAgenda, writeFrontmatter, parseFrontmatter } from "../src/store.mjs";
import { CallDayUnsetError } from "../src/paths.mjs";
import { ScanError } from "../src/scan.mjs";
import { PathError } from "../src/limits.mjs";
import { FakeRepo } from "./helpers/fakeRepo.mjs";

const NOW = new Date("2026-10-07T13:00:00Z");
const CONFIG = '{"callWeekday":3,"callTime":"09:00","timezone":"America/New_York","publicAgendaTitles":true}';
const NEXT = "2026-10-14";
const ITEM = `agenda/${NEXT}/context-window-mcp-7j40.md`;

const base = () => ({
  title: "Context Window MCP",
  note: "Ship the stdio server.",
  link: "https://example.com/mcp",
  call_date: NEXT,
});

test("MCP-AGENDA-001 the item file carries the four frontmatter keys and the note as body", async () => {
  const repo = new FakeRepo({ "config.json": CONFIG });
  const out = await addAgendaItem({ repo, login: "micah", now: NOW, ...base() });

  assert.equal(out.path, ITEM);
  const written = repo.writes.find((w) => w.path === ITEM);
  assert.ok(written, "the item path is what was written");
  const { data, body } = parseFrontmatter(written.text);
  assert.deepEqual(data, {
    title: "Context Window MCP",
    author: "micah",
    added: "2026-10-07T13:00:00.000Z",
    link: "https://example.com/mcp",
  });
  assert.equal(body.trim(), "Ship the stdio server.");
});

test("MCP-AGENDA-001 each call date folder holds its own files, never a shared one", async () => {
  const repo = new FakeRepo({ "config.json": CONFIG });
  await addAgendaItem({ repo, login: "micah", now: NOW, ...base() });
  await addAgendaItem({ repo, login: "micah", now: NOW, ...base(), title: "Other item" });

  assert.deepEqual(
    repo.paths(),
    [ITEM, `agenda/${NEXT}/other-item-7j40.md`],
    "one write per item",
  );
});

test("MCP-AGENDA-001 the commit message is the tool name and the title", async () => {
  const repo = new FakeRepo({ "config.json": CONFIG });
  await addAgendaItem({ repo, login: "micah", now: NOW, ...base() });
  assert.equal(repo.messageFor(ITEM), "add_agenda_item: Context Window MCP");
});

// The author comes from the identity value the deps resolved, so a decoy in the args object
// has to lose.
test("MCP-AUTH-003 the author line is the login, not an args value", async () => {
  const repo = new FakeRepo({ "config.json": CONFIG });
  await addAgendaItem({ repo, login: "from-token", now: NOW, ...base(), author: "from-args" });
  const { data } = parseFrontmatter(repo.writes[0].text);
  assert.equal(data.author, "from-token");
});

test("MCP-AGENDA-002 an omitted call_date is computed from config.json", async () => {
  const repo = new FakeRepo({ "config.json": CONFIG });
  const { call_date } = await addAgendaItem({
    repo,
    login: "micah",
    now: new Date("2026-10-05T09:00:00Z"),
    title: "Alpha",
  });
  assert.equal(call_date, "2026-10-07");
  assert.equal(repo.writes[0].path, "agenda/2026-10-07/alpha-r6o0.md");
});

test("MCP-AGENDA-002 an explicit call_date outranks the computed one", async () => {
  const repo = new FakeRepo({ "config.json": CONFIG });
  const out = await addAgendaItem({ repo, login: "micah", now: NOW, title: "Alpha", call_date: "2026-11-01" });
  assert.equal(out.call_date, "2026-11-01");
  assert.match(repo.writes[0].path, /^agenda\/2026-11-01\//);
});

test("MCP-AGENDA-002 a config without callWeekday surfaces the config error", async () => {
  const repo = new FakeRepo({ "config.json": '{"callWeekday":null,"callTime":null,"timezone":"America/New_York"}' });
  await assert.rejects(
    () => addAgendaItem({ repo, login: "micah", now: NOW, title: "Alpha" }),
    (e) => e instanceof CallDayUnsetError && /Set callWeekday in config\.json/.test(e.message),
  );
});

test("MCP-AGENDA-003 no week reads the next call date and returns author and link", async () => {
  const repo = new FakeRepo({
    "config.json": CONFIG,
    [ITEM]: [
      "---",
      "title: Context Window MCP",
      "author: micah",
      "added: 2026-10-06T13:00:00.000Z",
      "link: https://example.com/mcp",
      "---",
      "Ship the stdio server.",
    ].join("\n"),
    "agenda/2026-10-07/older-0001.md": "---\ntitle: Older\nauthor: micah\nadded: 2026-10-01T13:00:00.000Z\n---\nOld note.\n",
    "README.md": "# Data repo\n",
  });

  const out = await listAgenda({ repo, now: NOW });
  assert.equal(out.call_date, NEXT);
  assert.equal(out.items.length, 1, "the other week's folder stays out of the screen");
  assert.equal(out.items[0].title, "Context Window MCP");
  assert.equal(out.items[0].author, "micah");
  assert.equal(out.items[0].link, "https://example.com/mcp");
  assert.equal(out.items[0].summary, "Ship the stdio server.");
});

test("MCP-AGENDA-003 items of one call date come back newest first by added", async () => {
  const repo = new FakeRepo({
    "config.json": CONFIG,
    [`agenda/${NEXT}/a-1111.md`]: "---\ntitle: A\nauthor: micah\nadded: 2026-10-06T10:00:00.000Z\n---\nfirst\n",
    [`agenda/${NEXT}/b-2222.md`]: "---\ntitle: B\nauthor: micah\nadded: 2026-10-07T09:00:00.000Z\n---\nsecond\n",
    [`agenda/${NEXT}/c-3333.md`]: "---\ntitle: C\nauthor: micah\nadded: 2026-10-06T08:00:00.000Z\n---\nthird\n",
  });
  assert.deepEqual(
    (await listAgenda({ repo, now: NOW })).items.map((i) => i.title),
    ["B", "A", "C"],
  );
});

test("MCP-AGENDA-004 a week argument reads that call date instead", async () => {
  const repo = new FakeRepo({
    "config.json": CONFIG,
    [ITEM]: "---\ntitle: Next week item\nauthor: micah\nadded: 2026-10-07T09:00:00.000Z\n---\n",
    "agenda/2026-10-07/older-0001.md":
      "---\ntitle: Older\nauthor: micah\nadded: 2026-10-01T13:00:00.000Z\nlink: https://example.com/a\n---\nOld note.\n",
  });

  const out = await listAgenda({ repo, now: NOW, week: "2026-10-07" });
  assert.equal(out.call_date, "2026-10-07");
  assert.deepEqual(out.items, [
    {
      path: "agenda/2026-10-07/older-0001.md",
      title: "Older",
      author: "micah",
      added: "2026-10-01T13:00:00.000Z",
      link: "https://example.com/a",
      summary: "Old note.",
      share: "",
      files: [],
      repo_url: "",
    },
  ]);
});

test("MCP-AGENDA-003 an empty call date is an empty screen, not a missing key", async () => {
  const repo = new FakeRepo({ "config.json": CONFIG });
  assert.deepEqual(await listAgenda({ repo, now: NOW, week: "2026-12-01" }), {
    call_date: "2026-12-01",
    items: [],
  });
});

test("MCP-SHARE-001 the frontmatter records the share id and the file list", async () => {
  const repo = new FakeRepo({ "config.json": CONFIG });
  const out = await addAgendaItem({
    repo,
    login: "micah",
    now: NOW,
    ...base(),
    files: [
      { path: "src/a.mjs", content: "export const a = 1;\n" },
      { path: "README.md", content: "# A\n" },
    ],
  });

  assert.match(out.share, /^20261007-micah-[0-9a-z]{4}$/);
  assert.deepEqual(
    repo.writes.map((w) => w.path),
    [
      `shares/${out.share}/src/a.mjs`,
      `shares/${out.share}/README.md`,
      ITEM,
    ],
  );

  const { data } = parseFrontmatter(repo.messageFor(ITEM) && repo.writes[2].text);
  assert.equal(data.share, out.share);
  assert.deepEqual(data.files, ["src/a.mjs", "README.md"]);
  assert.equal(repo.writes[0].text, "export const a = 1;\n");
});

test("MCP-SHARE-001 a share id ties the two write sets together and pull reads them back", async () => {
  const repo = new FakeRepo({ "config.json": CONFIG });
  const out = await addAgendaItem({
    repo,
    login: "micah",
    now: NOW,
    ...base(),
    files: [{ path: "src/a.mjs", content: "export const a = 1;\n" }],
    repo_url: "https://github.com/MicahFalde/contextwindow-mcp",
  });

  const { data } = parseFrontmatter(repo.writes.at(-1).text);
  assert.equal(data.repo_url, "https://github.com/MicahFalde/contextwindow-mcp");
  assert.equal(data.share, out.share);
  assert.equal(data.files.length, 1);
});

test("MCP-SHARE-002 a share of 26 files is rejected by the count limit, nothing written", async () => {
  const repo = new FakeRepo({ "config.json": CONFIG });
  const files = Array.from({ length: 26 }, (_, i) => ({ path: `f${i}`, content: "x" }));
  await assert.rejects(
    () => addAgendaItem({ repo, login: "micah", now: NOW, ...base(), files }),
    (e) => /^too many files: 26 > 25 files per share$/.test(e.message),
  );
  assert.deepEqual(repo.writes, []);
});

test("MCP-SHARE-005 a dotted path is rejected by the path gate", async () => {
  const repo = new FakeRepo({ "config.json": CONFIG });
  await assert.rejects(
    () => addAgendaItem({ repo, login: "micah", now: NOW, ...base(), files: [{ path: "../x", content: "x" }] }),
    (e) => e instanceof PathError && /path contains "\.\."/.test(e.message),
  );
  assert.equal(repo.writes.length, 0);
});

test("MCP-SCAN-002 secret-bearing content is rejected with pointers and no values", async () => {
  const repo = new FakeRepo({ "config.json": CONFIG });
  await assert.rejects(
    () =>
      addAgendaItem({
        repo,
        login: "micah",
        now: NOW,
        title: "Alpha",
        note: "PORT=3000",
        files: [{ path: "src/a.mjs", content: 'MY_KEY=ABCDEFGHIJKLmnopqrst01345678' }],
      }),
    (e) =>
      e instanceof ScanError &&
      /src\/a\.mjs:1 high-entropy-assignment/.test(e.message) &&
      !e.message.includes("ABCDEFGHIJKLmnopqrst01345678"),
  );
  assert.equal(repo.writes.length, 0);
});

test("MCP-SCAN-002 the note is scanned as well as the files", async () => {
  const repo = new FakeRepo({ "config.json": CONFIG });
  await assert.rejects(
    () => addAgendaItem({ repo, login: "micah", now: NOW, title: "Alpha", note: "ghp_" + "a".repeat(36) }),
    (e) => e instanceof ScanError && /note:1 github-token/.test(e.message),
  );
  assert.equal(repo.writes.length, 0);
});

test("MCP-SHARE-001 writeFrontmatter drops empty keys and JSONs the list keys", () => {
  const text = writeFrontmatter(
    { title: "A", link: "", files: ["src/a.mjs", "README.md"], added: "2026-10-07T13:00:00.000Z" },
    "Note body.\n",
  );
  assert.equal(
    text,
    [
      "---",
      "title: A",
      "files: [\"src/a.mjs\",\"README.md\"]",
      "added: 2026-10-07T13:00:00.000Z",
      "---",
      "Note body.\n",
    ].join("\n"),
  );
  assert.equal(text.includes("link:"), false, "an empty value means the key is absent");
});

test("MCP-SHARE-001 parseFrontmatter round-trips the block and keeps the body whole", () => {
  const text = writeFrontmatter({ title: "A", links: ["https://example.com"], updated: "x" }, "Line one.\nLine two.");
  const { data, body } = parseFrontmatter(text);
  assert.deepEqual(data, { title: "A", links: ["https://example.com"], updated: "x" });
  assert.equal(body, "Line one.\nLine two.");
});

test("MCP-SHARE-001 text without a fence parses to no keys and the whole body", () => {
  assert.deepEqual(parseFrontmatter("# Just markdown\n"), {
    data: {},
    body: "# Just markdown\n",
  });
  assert.deepEqual(parseFrontmatter(""), { data: {}, body: "" });
});

test("MCP-SHARE-001 a list key whose value is not JSON stays the raw string", () => {
  const { data } = parseFrontmatter("---\nfiles: src/a.mjs\n---\nbody");
  assert.equal(data.files, "src/a.mjs");
});
