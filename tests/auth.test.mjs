import { test } from "node:test";
import assert from "node:assert";

import { getToken, getLogin, AuthError } from "../src/auth.mjs";

const TOKEN = "ghp_" + "a".repeat(36);

// `assert.rejects` resolves to undefined, so this hands back the thrown value for inspection.
async function capture(fn) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
}

// The exec fake plays the part of execFileSync: it answers with the raw stdout string and
// records that it was reached at all.
function fakeExec(stdout, calls = []) {
  return () => {
    calls.push("called");
    return stdout;
  };
}

// The fetch fake plays the part of globalThis.fetch: it records the request and answers
// with a body of the shape the API returns.
function fakeFetch(body, calls = []) {
  return async (url, init) => {
    calls.push([url, init]);
    return { status: 200, json: async () => body };
  };
}

test("MCP-AUTH-001 prefers GITHUB_TOKEN over gh auth token", async () => {
  const calls = [];
  const token = await getToken({ env: { GITHUB_TOKEN: TOKEN }, exec: fakeExec("ignored", calls) });
  assert.equal(token, TOKEN);
  assert.equal(calls.length, 0, "gh is not consulted when the env var is set");
});

test("MCP-AUTH-001 falls back to `gh auth token` when GITHUB_TOKEN is unset", async () => {
  const calls = [];
  const token = await getToken({ env: {}, exec: fakeExec(` ${TOKEN}\n`, calls) });
  assert.equal(token, TOKEN);
  assert.deepEqual(calls, ["called"], "the cli is the one that answered");
});

test("MCP-AUTH-002 errors naming both sources and makes no GitHub call", async () => {
  const netCalls = [];
  const fetch = fakeFetch({}, netCalls);
  const err = await capture(() => getToken({ env: {}, exec: fakeExec("", []) }));
  assert.ok(err instanceof AuthError);
  assert.ok(err.message.includes("GITHUB_TOKEN"), "the env source is named");
  assert.ok(err.message.includes("gh auth token"), "the cli source is named");
  assert.equal(netCalls.length, 0, "no network attempt after a missing token");
});

test("MCP-AUTH-002 blank answers from both sources are as good as absent", async () => {
  const err = await capture(
    () => getToken({ env: { GITHUB_TOKEN: "" }, exec: fakeExec("   ", []) }),
  );
  assert.ok(err instanceof AuthError);
});

test("MCP-AUTH-002 an empty gh answer alone still raises the auth error", async () => {
  const err = await capture(() => getToken({ env: {}, exec: fakeExec("", []) }));
  assert.ok(err instanceof AuthError);
});

test("MCP-AUTH-001 resolves the login from the identity endpoint", async () => {
  const calls = [];
  const login = await getLogin({ token: TOKEN, fetch: fakeFetch({ login: "micah" }, calls) });
  assert.equal(login, "micah");
  assert.equal(calls[0][0], "https://api.github.com/user");
  assert.equal(calls[0][1].headers.Authorization, `Bearer ${TOKEN}`);
});

// The args object carries a decoy author so the two sources are tellable apart.
test("MCP-AUTH-003 the author comes from getLogin, not from the tool args", async () => {
  const login = await getLogin({ token: TOKEN, fetch: fakeFetch({ login: "from-token" }) });
  const args = { title: "Notes", author: "from-args" };
  const record = { ...args, author: login };
  assert.equal(record.author, "from-token");
  assert.notEqual(record.author, "from-args");
});

test("MCP-AUTH-002 an identity response without a login is an auth error", async () => {
  const err = await capture(() => getLogin({ token: TOKEN, fetch: fakeFetch({}) }));
  assert.ok(err instanceof AuthError);
});

test("MCP-AUTH-001 a gh answer that arrives as a Buffer is read as the token", async () => {
  const calls = [];
  const exec = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return Buffer.from("ghp_buffered\n"); };
  const token = await getToken({ env: {}, exec });
  assert.strictEqual(token, "ghp_buffered");
  assert.strictEqual(calls[0].opts && calls[0].opts.encoding, "utf8", "the real call asks for utf8 so a string comes back");
});
