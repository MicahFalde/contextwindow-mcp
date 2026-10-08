import { test } from "node:test";
import assert from "node:assert";

import { GitHubRepo, repoName } from "../src/github.mjs";

const TOKEN = "ghp_" + "b".repeat(36);

// Scripted responses: each queued entry answers the next request, so a retry sequence is
// just a list of statuses. The last entry repeats when the queue runs out.
function scriptedFetch(queue, calls = []) {
  const fetch = async (url, init) => {
    const entry = queue.length > 1 ? queue.shift() : queue[0];
    calls.push({ url, init });
    return { status: entry.status ?? 200, json: async () => entry.body };
  };
  return { fetch, calls };
}

test("MCP-GIT-004 defaults the data repo name", () => {
  assert.equal(repoName({}), "MicahFalde/contextwindow");
});

test("MCP-GIT-004 reads the data repo name from CONTEXTWINDOW_REPO", () => {
  assert.equal(
    repoName({ CONTEXTWINDOW_REPO: "Someone/else" }),
    "Someone/else",
  );
});

test("MCP-GIT-004 falls back when the variable is present but empty", () => {
  assert.equal(repoName({ CONTEXTWINDOW_REPO: "" }), "MicahFalde/contextwindow");
});

test("MCP-GIT-004 an instance picks up the configured repo in its URLs", async () => {
  const { fetch, calls } = scriptedFetch([{ status: 200, body: { sha: "s", content: "" } }]);
  const repo = new GitHubRepo({ token: TOKEN, repo: "Someone/else", fetch });
  await repo.readFile("a/b.md");
  assert.equal(
    calls[0].url,
    "https://api.github.com/repos/Someone/else/contents/a/b.md?ref=main",
  );
});

test("MCP-GIT-004 headers follow the contract", async () => {
  const { fetch, calls } = scriptedFetch([{ status: 200, body: { sha: "s", content: "" } }]);
  await new GitHubRepo({ token: TOKEN, fetch }).readFile("a.md");
  const { headers } = calls[0].init;
  assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(headers.Accept, "application/vnd.github+json");
  assert.equal(headers["User-Agent"], "contextwindow-mcp");
  // JSON omits an undefined Content-Type, so the literal spelling is what is asserted.
  assert.equal(headers["Content-Type"], "application/json");
});

test("MCP-GIT-002 a new file is PUT without a sha", async () => {
  const calls = [];
  const { fetch } = scriptedFetch(
    [
      { status: 404, body: null },
      { status: 201, body: { commit: { sha: "c" } } },
    ],
    calls,
  );
  const out = await new GitHubRepo({ token: TOKEN, fetch }).writeFile("new.md", "x", { message: "m" });
  assert.deepEqual(out, { commit: { sha: "c" } });
  const sent = JSON.parse(calls[1].init.body);
  assert.equal("sha" in sent, false, "an absent file has no sha to guard");
});

test("MCP-GIT-002 decodes base64 file contents with the sha", async () => {
  const content = Buffer.from("hello", "utf8").toString("base64");
  const { fetch } = scriptedFetch([{ status: 200, body: { sha: "abc", content } }]);
  const file = await new GitHubRepo({ token: TOKEN, fetch }).readFile("a.md");
  assert.deepEqual(file, { sha: "abc", text: "hello" });
});

test("MCP-GIT-002 maps a 404 to null instead of an empty file", async () => {
  const { fetch } = scriptedFetch([{ status: 404, body: null }]);
  const file = await new GitHubRepo({ token: TOKEN, fetch }).readFile("missing.md");
  assert.equal(file, null);
});

test("MCP-GIT-002 lists the recursive tree with its four fields", async () => {
  const { fetch, calls } = scriptedFetch([
    {
      status: 200,
      body: {
        tree: [
          { path: "README.md", type: "blob", sha: "1", size: 10, url: "x" },
          { path: "agenda", type: "tree", sha: "2" },
        ],
      },
    },
  ]);
  const tree = await new GitHubRepo({ token: TOKEN, fetch }).listTree();
  assert.equal(calls[0].url, "https://api.github.com/repos/MicahFalde/contextwindow/git/trees/main?recursive=1");
  assert.deepEqual(tree, [
    { path: "README.md", type: "blob", size: 10, sha: "1" },
    { path: "agenda", type: "tree", size: undefined, sha: "2" },
  ]);
});

test("MCP-GIT-003 formats a commit message as tool colon title", () => {
  assert.equal(GitHubRepo.commitMessage("add_agenda_item", "Weekly prep"), "add_agenda_item: Weekly prep");
});

test("MCP-GIT-003 the PUT body carries the message, base64 content and branch", async () => {
  const calls = [];
  const { fetch } = scriptedFetch(
    [
      { status: 200, body: { sha: "s1", content: "" } },
      { status: 200, body: { commit: { sha: "c" } } },
    ],
    calls,
  );
  await new GitHubRepo({ token: TOKEN, fetch }).writeFile("a.md", "body", {
    message: GitHubRepo.commitMessage("share_project", "P"),
  });
  const put = calls.find((c) => c.init?.method === "PUT");
  const sent = JSON.parse(put.init.body);
  assert.deepEqual(sent, {
    message: "share_project: P",
    // The existing file's sha rides along as the conflict guard.
    sha: "s1",
    content: Buffer.from("body", "utf8").toString("base64"),
    branch: "main",
  });
  assert.equal(put.url, "https://api.github.com/repos/MicahFalde/contextwindow/contents/a.md?ref=main");
});

test("MCP-GIT-002 a stale sha 409 refetches the sha and retries", async () => {
  const queue = [
    { status: 200, body: { sha: "old", content: "" } },
    { status: 409, body: { message: "sync failed" } },
    { status: 200, body: { sha: "new", content: "" } },
    { status: 200, body: { commit: { sha: "c2" } } },
  ];
  const { fetch, calls } = scriptedFetch(queue);
  const repo = new GitHubRepo({ token: TOKEN, fetch });
  const out = await repo.writeFile("a.md", "body", { message: "t: T" });
  assert.deepEqual(out, { commit: { sha: "c2" } });
  // read, put(409), read, put(ok)
  assert.equal(calls.length, 4);
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(JSON.parse(calls[1].init.body).sha, "old");
  assert.equal(JSON.parse(calls[3].init.body).sha, "new");
});

test("MCP-GIT-002 a 422 also triggers the refetch-and-retry path", async () => {
  const queue = [
    { status: 200, body: { sha: "old", content: "" } },
    { status: 422, body: {} },
    { status: 200, body: { sha: "mid", content: "" } },
    { status: 200, body: { commit: { sha: "c3" } } },
  ];
  const { fetch, calls } = scriptedFetch(queue);
  const out = await new GitHubRepo({ token: TOKEN, fetch }).writeFile("a.md", "b", { message: "m" });
  assert.deepEqual(out, { commit: { sha: "c3" } });
  assert.equal(calls.length, 4);
});

test("MCP-GIT-002 stops after three attempts and throws", async () => {
  const { fetch, calls } = scriptedFetch([
    { status: 200, body: { sha: "old", content: "" } },
    { status: 409, body: {} },
  ]);
  await assert.rejects(
    () => new GitHubRepo({ token: TOKEN, fetch }).writeFile("a.md", "b", { message: "m" }),
    (err) => err instanceof Error && /3 attempts/.test(err.message),
  );
  // one initial read plus three PUTs each followed by a sha refetch
  assert.equal(calls.length, 7);
  const puts = calls.filter((c) => c.init?.method === "PUT");
  assert.equal(puts.length, 3);
});

test("MCP-GIT-002 a non-conflict failure stops immediately", async () => {
  const { fetch, calls } = scriptedFetch([
    { status: 200, body: { sha: "old", content: "" } },
    { status: 400, body: { message: "bad" } },
  ]);
  await assert.rejects(
    () => new GitHubRepo({ token: TOKEN, fetch }).writeFile("a.md", "b", { message: "m" }),
    Error,
  );
  assert.equal(calls.filter((c) => c.init?.method === "PUT").length, 1);
});
