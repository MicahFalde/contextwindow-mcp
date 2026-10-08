import { test } from "node:test";
import assert from "node:assert";

import { logRecap } from "../src/store.mjs";
import { parseFrontmatter } from "../src/store.mjs";
import { FakeRepo } from "./helpers/fakeRepo.mjs";

const NOW = new Date("2026-10-07T13:00:00Z");
const PATH = "recaps/2026-10-07.md";
const RECAP = "Shipped the stdio server.\nNext: prompts.";

test("MCP-RECAP-001 the recap file carries author, logged and call with the recap as body", async () => {
  const repo = new FakeRepo({ "config.json": "{}" });
  const out = await logRecap({ repo, login: "micah", now: NOW, call_date: "2026-10-07", recap: RECAP });

  assert.equal(out.path, PATH);
  assert.equal(out.call_date, "2026-10-07");
  const { data, body } = parseFrontmatter(repo.writes[0].text);
  assert.deepEqual(data, {
    author: "micah",
    logged: "2026-10-07T13:00:00.000Z",
    call: "2026-10-07",
  });
  assert.equal(body, RECAP);
  assert.equal(repo.writes[0].message, "log_recap: 2026-10-07");
});

test("MCP-RECAP-001 a second log for the same date replaces that one file", async () => {
  const repo = new FakeRepo({});
  await logRecap({ repo, login: "micah", now: NOW, call_date: "2026-10-07", recap: "First." });
  await logRecap({
    repo,
    login: "micah",
    now: new Date("2026-10-08T09:00:00Z"),
    call_date: "2026-10-07",
    recap: "Second.",
  });

  assert.deepEqual(repo.paths(), [PATH, PATH]);
  const text = repo.files.get(PATH);
  assert.equal(text.includes("Second."), true);
  assert.equal(text.includes("First."), false, "the earlier body is gone");
  assert.equal(text.includes("logged: 2026-10-08T09:00:00.000Z"), true);
});

test("MCP-RECAP-001 two call dates are two files, one each", async () => {
  const repo = new FakeRepo({});
  await logRecap({ repo, login: "micah", now: NOW, call_date: "2026-10-07", recap: "A" });
  await logRecap({ repo, login: "micah", now: NOW, call_date: "2026-10-14", recap: "B" });
  assert.deepEqual(repo.paths(), ["recaps/2026-10-07.md", "recaps/2026-10-14.md"]);
});

test("MCP-AUTH-003 the recap author is the login the server resolved", async () => {
  const repo = new FakeRepo({});
  await logRecap({ repo, login: "from-token", now: NOW, call_date: "2026-10-07", recap: "A" });
  assert.equal(parseFrontmatter(repo.writes[0].text).data.author, "from-token");
});
