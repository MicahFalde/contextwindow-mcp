# Contract: data formats shared by contextwindow (data repo) and contextwindow-mcp

Both repos parse and write these exactly. Change here first, then both repos.

## Repo layout (private repo MicahFalde/contextwindow, branch main)
```
config.json                      {"callWeekday":null|0-6,"callTime":null|"HH:MM","timezone":"America/New_York","publicAgendaTitles":true}
members.md                       lines: "- <github-login>: <Display Name>"
agenda/<YYYY-MM-DD>/<slug>.md    one item per file; folder = call date
projects/<login>/<slug>.md       one project per file; upsert by path
recaps/<YYYY-MM-DD>.md           one per call date
shares/<share-id>/<orig/path>    attached files, original relative paths
```

## Frontmatter
Files start with `---`, then `key: value` lines, then `---`, then the markdown body.
Values are plain strings except keys ending in `s` that hold lists, which are JSON arrays
on one line: `files: ["src/a.ts","README.md"]`, `links: ["https://..."]`. Empty value = key absent.

Agenda item keys:  title, author, added (ISO 8601 UTC), link, share, files, repo_url
Project keys:      name, status, author, updated (ISO 8601 UTC), links, share, files, repo_url
Recap keys:        author, logged (ISO 8601 UTC), call (YYYY-MM-DD)

## Identifiers
slug      = title lowercased, [^a-z0-9]+ -> "-", trimmed of "-", cut to 60 chars, then "-" + 4 lowercase base36 chars from Date.now()
share-id  = <YYYYMMDD>-<login>-<4 base36 chars>
call date = next occurrence of config.callWeekday in config.timezone; if today is that weekday and callTime has passed (or callTime null and it is after 12:00 local), use next week. If callWeekday is null and no call_date was given, the tool returns an error telling the member to set callWeekday in config.json.

## Limits
25 files per share, 250 KB per file, 2 MB per share. Paths may not contain "..", start with "/", or have basename ".env" / ".env.*".

## Secret scan rules (names are what the error reports)
private-key (-----BEGIN ... PRIVATE KEY-----), aws-access-key (AKIA[0-9A-Z]{16}), github-token (gh[pousr]_[A-Za-z0-9]{36,}), slack-token (xox[baprs]-[A-Za-z0-9-]{10,}), google-api-key (AIza[0-9A-Za-z_-]{35}), stripe-key (sk_(live|test)_[0-9a-zA-Z]{24,}), jwt (eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}), high-entropy-assignment (line matching /^[A-Z0-9_]{3,}\s*=\s*["']?([^\s"']{21,})/ whose captured value has Shannon entropy > 4.0 bits/char).

## MCP SDK usage (v1.32, do not use older APIs)
```js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "contextwindow", version: "0.1.0" });
server.registerTool("add_agenda_item", { description: "...", inputSchema: { title: z.string(), note: z.string().optional() } }, async (args) => ({ content: [{ type: "text", text: "..." }] }));
server.registerPrompt("prep", { description: "...", argsSchema: {} }, () => ({ messages: [{ role: "user", content: { type: "text", text: "..." } }] }));
await server.connect(new StdioServerTransport());
```
Tool errors: return `{ isError: true, content: [{ type: "text", text: msg }] }`.

## GitHub API (REST, token from auth)
- identity: GET https://api.github.com/user -> login
- read file: GET /repos/{repo}/contents/{path}?ref=main -> { sha, content (base64) }; 404 = absent
- list tree: GET /repos/{repo}/git/trees/main?recursive=1 -> { tree: [{path,type,sha,size}] }
- write file: PUT /repos/{repo}/contents/{path} body { message, content (base64), sha? , branch: "main" }
  stale sha -> 409 or 422: refetch sha, retry, max 3 attempts
- headers: Authorization: Bearer <token>, Accept: application/vnd.github+json, User-Agent: contextwindow-mcp
