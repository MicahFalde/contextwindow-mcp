// The six tool definitions. The handlers stay thin: parse, call one store function, render.
// Every failure becomes an isError result whose text is the caught message, which is
// already the shape the scan and the limit errors want (values out, pointers in).

import { z } from "zod";
import { LIMITS } from "./limits.mjs";
import { getToken, getLogin } from "./auth.mjs";
import { GitHubRepo, repoName } from "./github.mjs";
import {
  addAgendaItem,
  listAgenda,
  shareProject,
  getProjects,
  pullShare,
  logRecap,
} from "./store.mjs";

// The one sentence MCP-SHARE-004 asks for, shared by both writers so they cannot drift.
const ATTACH = "Attach files only when the member explicitly asks to share code.";
const LIMITS_TEXT = `Limits: ${LIMITS.files} files per share, ${LIMITS.perFileBytes} bytes per file, ${LIMITS.totalBytes} bytes in total; anything larger goes through repo_url.`;

// A file entry as the contract spells it: original relative path plus its text.
const fileSchema = z.object({ path: z.string(), content: z.string() });

/** Register the six tools on `server`.
 *
 *  MCP-AGENDA-001, MCP-AGENDA-002, MCP-AGENDA-003, MCP-AGENDA-004, MCP-PROJ-001,
 *  MCP-PROJ-002, MCP-PROJ-003, MCP-SHARE-001, MCP-SHARE-003, MCP-SHARE-004, MCP-RECAP-001 */
export function registerTools(server, deps) {
  server.registerTool(
    "add_agenda_item",
    {
      description:
        `Add one item to the next call's agenda. ` +
        `${ATTACH} ${LIMITS_TEXT}`,
      inputSchema: {
        title: z.string(),
        note: z.string().optional(),
        link: z.string().optional(),
        call_date: z.string().optional(),
        files: z.array(fileSchema).optional(),
        repo_url: z.string().optional(),
      },
    },
    wrap(deps, async (args, bag, now) => await withRepo(bag, (repo, login) => addAgendaItem({ repo, login, now, ...args }))),
  );

  server.registerTool(
    "list_agenda",
    {
      description:
        "List the agenda for the next call, newest first, or for one call date when week is given as YYYY-MM-DD.",
      inputSchema: { week: z.string().optional() },
    },
    wrap(deps, async ({ week }, bag, now) =>
      await withRepo(bag, (repo) => listAgenda({ repo, now, week })),
    ),
  );

  server.registerTool(
    "share_project",
    {
      description:
        `Share or refresh what you are building, keyed by its name. ` +
        `${ATTACH} ${LIMITS_TEXT}`,
      inputSchema: {
        name: z.string(),
        status: z.string().optional(),
        summary: z.string().optional(),
        links: z.array(z.string()).optional(),
        files: z.array(fileSchema).optional(),
        repo_url: z.string().optional(),
      },
    },
    wrap(deps, async (args, bag, now) => await withRepo(bag, (repo, login) => shareProject({ repo, login, now, ...args }))),
  );

  server.registerTool(
    "get_projects",
    {
      description:
        "List every shared project with its name, author, status, updated date and summary. Attached files are not returned.",
      inputSchema: { author: z.string().optional(), query: z.string().optional() },
    },
    wrap(deps, async ({ author, query }, bag) =>
      await withRepo(bag, (repo) => getProjects({ repo, author, query })),
    ),
  );

  server.registerTool(
    "pull_share",
    {
      description: "Return every file of one share with its original relative path and content.",
      inputSchema: { share_id: z.string() },
    },
    wrap(deps, async ({ share_id }, bag) => await withRepo(bag, (repo) => pullShare({ repo, share_id }))),
  );

  server.registerTool(
    "log_recap",
    {
      description: "Store the recap of a call that has already happened, keyed by its call date.",
      inputSchema: { call_date: z.string(), recap: z.string() },
    },
    wrap(deps, async (args, bag, now) => await withRepo(bag, (repo, login) => logRecap({ repo, login, now, ...args }))),
  );
}

/** Build the fresh dependency bag. Each getter memoizes onto itself once it has answered, so
 *  the identity round trip happens at most once per server while the first tool call is
 *  still what triggers it, which is what keeps `tools/list` offline (MCP-NFR-001).
 *
 *  MCP-AUTH-001, MCP-AUTH-002, MCP-AUTH-003, MCP-GIT-004 */
export function makeDeps(env = process.env) {
  // One cell per value, filled on first read: the identity round trip happens at most once
  // per bag while the first tool call is still what triggers it, which is what keeps
  // `tools/list` offline (MCP-NFR-001).
  const cache = {};
  const once = (key, make) => async () => (cache[key] ??= await make());

  const bag = {};
  bag.getToken = () => once("token", () => getToken({ env }))();
  bag.getLogin = () =>
    once("login", async () => await getLogin({ token: await bag.getToken(), fetch: globalThis.fetch }))();
  // The token is passed through so the client is built from the very value that answered.
  bag.getRepo = (token) =>
    once("repo", async () => new GitHubRepo({ token: token ?? await bag.getToken(), repo: repoName(env), fetch: globalThis.fetch }))();
  return bag;
}

// The repo client and the login both derive from the token, so the token answers first and
// the rest follow. The stamp is threaded through so every timestamp key of one record agrees.
// MCP-AUTH-002
async function withRepo({ getToken, getLogin, getRepo }, body, now) {
  await getToken();
  const login = await getLogin();
  return body(await getRepo(), login, now);
}

// The stamp each call is recorded at: one per call, so the two timestamp keys of a record
// agree. An injected value from the caller wins.
function stampFor(...candidates) {
  for (const value of candidates) if (value instanceof Date) return value;
  return new Date();
}

/** Run a handler and fold any thrown message into an isError result.
 *
 *  MCP-AUTH-002, MCP-SHARE-002, MCP-SHARE-005, MCP-SCAN-002 */
function wrap(deps, handler) {
  return async (args = {}, injected = deps) => {
    const bag = injected ?? deps;
    try {
      const now = stampFor(args?.now, bag?.now);
      return asResult(await handler(args, bag, now));
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error?.message ?? error) }] };
    }
  };
}

// Plain data becomes the one text block the protocol asks for; a result object passes through.
function asResult(value) {
  if (value && Array.isArray(value.content)) return value;
  return { content: [{ type: "text", text: JSON.stringify(value ?? null) }] };
}
