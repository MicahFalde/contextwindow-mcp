import { test } from "node:test";
import assert from "node:assert";

import { LIMITS, validateFiles, LimitError, PathError } from "../src/limits.mjs";

const KB = 1024;

test("MCP-SHARE-002 the shipped limits are 25 files, 250 KB and 2 MB", () => {
  assert.deepEqual(LIMITS, {
    files: 25,
    perFileBytes: 250 * KB,
    totalBytes: 2 * 1024 * 1024,
  });
  assert.equal(LIMITS.perFileBytes, 256000);
  assert.equal(LIMITS.totalBytes, 2097152);
});

test("MCP-SHARE-002 validateFiles returns the files unchanged inside every limit", () => {
  const files = [
    { path: "src/a.mjs", content: "export const a = 1;\n" },
    { path: "README.md", content: "# Context Window\n" },
    { path: "src/nested/deep.json", content: '{"a":1}' },
  ];
  const result = validateFiles(files);
  assert.equal(result === files, true);
  assert.deepEqual(result, files);
  // Exactly at each bound is still inside it.
  assert.equal(validateFiles(Array.from({ length: 25 }, (_, i) => ({ path: `f${i}`, content: "x" }))).length, 25);
  assert.equal(validateFiles([{ path: "f", content: "a".repeat(250 * KB) }]).length, 1);
  assert.equal(validateFiles(undefined).length, 0);
});

test("MCP-SHARE-002 a share over 25 files names the count limit", () => {
  const files = Array.from({ length: 26 }, (_, i) => ({ path: `f${i}.mjs`, content: "x" }));
  assert.throws(
    () => validateFiles(files),
    (e) =>
      e instanceof LimitError &&
      /^too many files: 26 > 25 files per share$/.test(e.message),
  );
});

test("MCP-SHARE-002 a file over 250 KB is named by its own path", () => {
  const files = [
    { path: "src/small.mjs", content: "x" },
    { path: "src/big.json", content: "a".repeat(250 * KB + 1) },
  ];
  assert.throws(
    () => validateFiles(files),
    (e) =>
      e instanceof LimitError &&
      /file too large: src\/big\.json is 256001 bytes > 256000 bytes per file/.test(e.message),
  );
});

test("MCP-SHARE-002 a share over 2 MB total is named by the total, not by any one file", () => {
  // 25 files at 90 KB each is 2304000 bytes while every entry is under 256000, so only the
  // sum can fail. 20 files of the same size is 1843200 bytes, inside the bound.
  const each = 90 * KB;
  const at20 = Array.from({ length: 20 }, (_, i) => ({ path: `f${i}.mjs`, content: "a".repeat(each) }));
  assert.equal(validateFiles(at20).length, 20);
  const over = Array.from({ length: 25 }, (_, i) => ({ path: `f${i}.mjs`, content: "a".repeat(each) }));
  assert.throws(
    () => validateFiles(over),
    (e) =>
      e instanceof LimitError &&
      /share too large: 2304000 bytes > 2097152 bytes total/.test(e.message),
  );
  assert.equal(25 * each, 2304000);
  assert.equal(20 * each, 1843200);
});

test("MCP-SHARE-002 size is measured in utf8 bytes, not in code units", () => {
  // A string of 128001 two-byte characters is 256002 bytes but only 128001 code units, so
  // the failing number in the message is the byte count: 256002 is over the 256000 bound
  // while the code-unit count would sit far inside it.
  assert.equal(Buffer.byteLength("ä".repeat(128001), "utf8"), 256002);
  assert.equal("ä".repeat(128001).length, 128001);
  assert.equal(validateFiles([{ path: "f", content: "ä".repeat(128000) }]).length, 1);
  assert.throws(
    () => validateFiles([{ path: "umlaut.mjs", content: "ä".repeat(128001) }]),
    (e) =>
      e instanceof LimitError &&
      /umlaut\.mjs is 256002 bytes > 256000 bytes per file/.test(e.message),
  );
});

test("MCP-SHARE-005 a path with .. is rejected as a PathError", () => {
  for (const path of ["../a.mjs", "src/../b.mjs"]) {
    assert.throws(
      () => validateFiles([{ path, content: "x" }]),
      (e) => e instanceof PathError && /\.\./.test(e.message) && e.message.includes(path),
    );
  }
});

test("MCP-SHARE-005 an absolute path and a missing path are rejected", () => {
  assert.throws(
    () => validateFiles([{ path: "/src/a.mjs", content: "x" }]),
    (e) => e instanceof PathError && /starts with "\/"/.test(e.message),
  );
  assert.throws(
    () => validateFiles([{ content: "x" }]),
    (e) => e instanceof PathError && /no path/.test(e.message),
  );
});

test("MCP-SHARE-005 dotenv basenames are rejected while ordinary files pass", () => {
  for (const path of [".env", "src/.env", ".env.local", "src/nested/.env.production"]) {
    assert.throws(
      () => validateFiles([{ path, content: "K=1" }]),
      (e) => e instanceof PathError && /dotenv/.test(e.message),
    );
  }
  assert.equal(validateFiles([{ path: "src/index.mjs", content: "x" }]).length, 1);
});

test("MCP-SHARE-005 the first failure stops the whole share, so nothing is partially accepted", () => {
  // The path check runs per entry before the totals, so entry 2 failing means the caller
  // never sees a returned list to write from.
  const files = [
    { path: "a.mjs", content: "x" },
    { path: "src/.env", content: "x" },
    { path: "c.mjs", content: "x" },
  ];
  assert.throws(() => validateFiles(files), (e) => e instanceof PathError);
});
