// In-memory stand-in for the contents client: a path map plus the same three methods the
// real class has, so a store function cannot tell the two apart. It never touches fetch.

import { GitHubRepo } from "../../src/github.mjs";

export class FakeRepo {
  constructor(files = {}) {
    this.files = new Map(Object.entries(files));
    this.writes = [];
  }

  async readFile(path) {
    const text = this.files.get(path);
    return text === undefined ? null : { sha: `sha-${path}`, text };
  }

  // The real tree lists folders too, so a caller that filters on `type` is exercised.
  async listTree() {
    const folders = new Set();
    const blobs = [];
    for (const [path, text] of this.files) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
      blobs.push({ path, type: "blob", sha: `sha-${path}`, size: (text ?? "").length });
    }
    return [
      ...[...folders].sort().map((path) => ({ path, type: "tree", sha: `dir-${path}`, size: undefined })),
      ...blobs,
    ];
  }

  // The real class guards a prior sha; here last write simply wins, as it does after the
  // retry loop has refetched.
  async writeFile(path, text, { message }) {
    this.files.set(path, text);
    this.writes.push({ path, text, message });
    return { commit: { sha: `commit-${this.writes.length}` } };
  }

  paths() {
    return this.writes.map((w) => w.path);
  }

  messageFor(path) {
    return this.writes.find((w) => w.path === path)?.message;
  }
}

export const REAL_REPO = GitHubRepo;
