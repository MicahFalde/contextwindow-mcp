// Thin contents-API client. One instance per call: the token carries the member's
// identity, so instances are not shared between members.

// A 409/422 means another member landed a commit between our read and our write, so
// only the sha is stale — the payload is still good and a refetch is enough.
// MCP-GIT-002
const MAX_WRITE_ATTEMPTS = 3;

// The name is a per-checkout choice, so it lives in the environment, not the code.
// MCP-GIT-004
export function repoName(env = process.env) {
  return env.CONTEXTWINDOW_REPO || "MicahFalde/contextwindow";
}

// Header set is fixed by the contract; the User-Agent is what shows up in the API logs.
function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "contextwindow-mcp",
    "Content-Type": "application/json",
  };
}

const API_BASE = "https://api.github.com";

export class GitHubRepo {
  constructor({ token, repo, fetch = globalThis.fetch } = {}) {
    this.token = token;
    this.repo = repo ?? repoName();
    this.fetch = fetch;
  }

  // A 404 is the normal "not there yet" answer for an upsert target that is unanswered,
  // which maps to null rather than an empty file.
  // MCP-GIT-002
  async readFile(path) {
    const res = await this.fetch(this.#contentsUrl(path), { headers: headers(this.token) });
    if (res.status === 404) return null;
    const body = await res.json();
    if (!body) return null;
    const text = body.content ? Buffer.from(body.content, "base64").toString("utf8") : "";
    return { sha: body.sha, text };
  }

  // The recursive tree is one request for every path, which is what keeps listing cheap.
  // MCP-GIT-002
  async listTree() {
    const res = await this.fetch(`${API_BASE}/repos/${this.repo}/git/trees/main?recursive=1`, {
      headers: headers(this.token),
    });
    const body = await res.json();
    return (body?.tree ?? []).map((e) => ({ path: e.path, type: e.type, size: e.size, sha: e.sha }));
  }

  // MCP-GIT-003
  static commitMessage(tool, title) {
    return `${tool}: ${title}`;
  }

  // The loop re-reads only the sha, so the caller's text is preserved verbatim across
  // attempts and only the guard changes.
  // MCP-GIT-002
  async writeFile(path, text, { message }) {
    let sha = (await this.readFile(path))?.sha;
    let lastStatus;
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
      const res = await this.fetch(this.#contentsUrl(path), {
        method: "PUT",
        headers: headers(this.token),
        body: JSON.stringify({
          message,
          content: Buffer.from(text, "utf8").toString("base64"),
          ...(sha ? { sha } : {}),
          branch: "main",
        }),
      });
      if (res.status === 200 || res.status === 201) return await res.json();
      lastStatus = res.status;
      if (res.status !== 409 && res.status !== 422) break;
      sha = (await this.readFile(path))?.sha;
    }
    throw new Error(
      `Write to ${path} failed after ${MAX_WRITE_ATTEMPTS} attempts (last status ${lastStatus}).`,
    );
  }

  // Segments are encoded individually so nested paths keep their slash separators.
  #contentsUrl(path) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return `${API_BASE}/repos/${this.repo}/contents/${encoded}?ref=main`;
  }
}
