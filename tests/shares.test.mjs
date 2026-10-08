import { test } from "node:test";
import assert from "node:assert";

import { pullShare } from "../src/store.mjs";
import { LIMITS } from "../src/limits.mjs";
import { FakeRepo } from "./helpers/fakeRepo.mjs";

const ID = "20261007-micah-7j40";
const OTHER = "20261007-micah-0000";

const twoFileShare = () =>
  new FakeRepo({
    "config.json": "{}",
    [`shares/${ID}/src/a.mjs`]: "export const a = 1;\n",
    [`shares/${ID}/src/nested/deep.json`]: '{"a":1}',
    [`shares/${OTHER}/src/b.mjs`]: "export const b = 2;\n",
    "README.md": "# Data repo\n",
  });

test("MCP-SHARE-003 a share id returns every file with its original relative path", async () => {
  const out = await pullShare({ repo: twoFileShare(), share_id: ID });
  assert.equal(out.share_id, ID);
  assert.deepEqual(out.files, [
    { relPath: "src/a.mjs", content: "export const a = 1;\n" },
    { relPath: "src/nested/deep.json", content: '{"a":1}' },
  ]);
});

test("MCP-SHARE-003 only the named share comes back", async () => {
  const out = await pullShare({ repo: twoFileShare(), share_id: OTHER });
  assert.deepEqual(out.files, [{ relPath: "src/b.mjs", content: "export const b = 2;\n" }]);
});

test("MCP-SHARE-003 an unknown id is an empty file list, not a missing key", async () => {
  assert.deepEqual(await pullShare({ repo: twoFileShare(), share_id: "nope" }), {
    share_id: "nope",
    files: [],
  });
  assert.deepEqual(await pullShare({ repo: new FakeRepo({}), share_id: ID }), { share_id: ID, files: [] });
});

test("MCP-SHARE-003 the shipped byte limits are the contract's numbers", () => {
  assert.equal(LIMITS.files, 25);
  assert.equal(LIMITS.perFileBytes, 250 * 1024);
  assert.equal(LIMITS.totalBytes, 2 * 1024 * 1024);
});

test("MCP-SHARE-003 a share read back is byte-for-byte what was written", async () => {
  const repo = twoFileShare();
  const written = repo.files.get(`shares/${ID}/src/a.mjs`);
  const [first] = (await pullShare({ repo, share_id: ID })).files;
  assert.equal(first.content, written);
  assert.equal(first.relPath.includes(`/shares/${ID}/`), false, "the prefix is stripped once");
});
