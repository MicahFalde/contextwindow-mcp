// Identity for the member operating the server. Every write into the data repo is
// attributed to this login, so it has to be derived from the token that actually
// made the call (MCP-AUTH-003) rather than restated by the caller.

import { execFileSync } from "node:child_process";

const IDENTITY_URL = "https://api.github.com/user";

// One error class for every identity failure, so callers can test it by instance.
export class AuthError extends Error {}

// Source order is strict: the environment value wins when present so a per-shell
// token overrides the gh keyring entry.
// MCP-AUTH-001
export async function getToken({ env = process.env, exec = execFileSync } = {}) {
  const fromEnv = env.GITHUB_TOKEN;
  if (fromEnv) return String(fromEnv);

  // `gh` prints the token on stdout; trim because the CLI appends a newline.
  const out = exec("gh", ["auth", "token"]);
  const token = typeof out === "string" ? out.trim() : String(out?.stdout ?? "").trim();
  if (token) return token;

  // Both sources are named so the member can fix either one without a second read.
  // MCP-AUTH-002
  throw new AuthError(
    "No GitHub token: neither GITHUB_TOKEN nor `gh auth token` returned a value.",
  );
}

// The login comes from the identity call, which is keyed by the token itself, while the
// args object is only the payload carrier.
// MCP-AUTH-003
export async function getLogin({ token, fetch = globalThis.fetch }) {
  const res = await fetch(IDENTITY_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "contextwindow-mcp",
    },
  });
  const body = await res.json();
  const login = body?.login ?? body?.data?.login;
  if (!login) throw new AuthError("GitHub identity response contained no login.");
  return String(login);
}
