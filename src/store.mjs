// The write/read layer over the GitHub contents client. It owns the on-disk shape named
// in CONTRACT.md: the frontmatter grammar, the four path families, and the order the two
// gates run in. Everything the MCP tools do is one of these six calls.

import {
  slugify,
  slugBase,
  shareId,
  nextCallDate,
  agendaPath,
  projectPath,
  recapPath,
  sharePath,
} from "./paths.mjs";
import { validateFiles } from "./limits.mjs";
import { assertClean } from "./scan.mjs";
import { GitHubRepo } from "./github.mjs";

const FM_OPEN = "---";
// "files" and "links" are the two list keys the contract names, so the list test is this
// exact set rather than a trailing-letter shape test.
const LIST_KEYS = new Set(["files", "links"]);
const SHARE_PREFIX = "shares/";

/** Serialize the contract's frontmatter block: `---`, `key: value`, `---`, body.
 *  The contract defines an empty value as an absent key, which covers the empty list too.
 *
 *  MCP-SHARE-001, MCP-AGENDA-001, MCP-PROJ-001, MCP-RECAP-001 */
export function writeFrontmatter(data = {}, body = "") {
  const lines = [FM_OPEN];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined || value === "") continue;
    // Contract: only `s`-terminated keys hold lists, and they hold them as one-line JSON.
    if (!LIST_KEYS.has(key)) {
      lines.push(`${key}: ${String(value)}`);
      continue;
    }
    const list = Array.isArray(value) ? value : [];
    if (list.length > 0) lines.push(`${key}: ${JSON.stringify(list)}`);
  }
  lines.push(FM_OPEN, String(body ?? ""));
  return lines.join("\n");
}

/** Read back what writeFrontmatter emitted. The value after the first colon is taken whole,
 *  so a JSON array on one line needs no further splitting. Unknown keys are kept, which is
 *  what lets a file written by the site or by an older build still parse.
 *
 *  MCP-SHARE-001 */
export function parseFrontmatter(text = "") {
  const data = {};
  const lines = String(text ?? "").split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (lines[i]?.trim() !== FM_OPEN) return { data, body: String(text ?? "") };
  i++;
  for (; i < lines.length && lines[i].trim() !== FM_OPEN; i++) {
    const match = /^([A-Za-z0-9_]+):[ \t]*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const [, key, value] = match;
    data[key] = LIST_KEYS.has(key) ? jsonOr(value) : value;
  }
  return { data, body: lines.slice(i + 1).join("\n") };
}

function jsonOr(text) {
  // A list key that was written by this module is the JSON form; a hand-edited value fails
  // to parse and stays the raw string rather than killing the whole read.
  if (!text.startsWith("[")) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The three gates run in the order they can fail cheapest: shape, then size, then the
// secret scan. 1. MCP-SHARE-005 2. MCP-SHARE-002 3. MCP-SCAN-003 (the scan is the last
// thing before the first network call, so rejected content is never transmitted).
function prepareFiles(files) {
  const list = (files ?? []).map((f) => ({ path: String(f?.path ?? ""), content: String(f?.content ?? "") }));
  const checked = validateFiles(list);
  assertClean(checked);
  return checked;
}

// One base64 decode per response; an absent file is "" so the parse yields no keys.
async function readText(repo, path) {
  return (await repo.readFile(path))?.text ?? "";
}

/** MCP-AGENDA-001, MCP-AGENDA-002, MCP-SHARE-001 */
export async function addAgendaItem({ repo, login, now = new Date(), title, note = "", link = "", call_date, files, repo_url }) {
  // MCP-SHARE-002, MCP-SHARE-005, then MCP-SCAN-003: the scan sees every character that is
  // about to travel, the note included.
  const prepared = prepareFiles(files);
  assertClean([{ path: "note", content: note }]);

  // MCP-AGENDA-002: the member's own call_date wins over the computed one.
  const callDate = call_date ?? nextCallDate(JSON.parse(await readText(repo, "config.json")), now);

  const id = prepared.length > 0 ? shareId(login, now) : "";
  const path = agendaPath(callDate, slugify(title, now.getTime()));
  // The note is the body, so it rides after the frontmatter that names the share id.
  const content = writeFrontmatter(
    { title, author: login, added: now.toISOString(), link, share: id, files: prepared.map((f) => f.path), repo_url },
    note,
  );

  // MCP-SHARE-001: the share files are written first so the agenda item that names its
  // share id never points at a set of paths that is still on its way.
  for (const file of prepared) {
    await repo.writeFile(sharePath(id, file.path), file.content, {
      message: GitHubRepo.commitMessage("add_agenda_item", file.path),
    });
  }

  // MCP-AGENDA-001 / MCP-AUTH-003: the author is the login resolved from the token, so it
  // travels as `login` rather than as something restated in the args.
  await repo.writeFile(path, content, { message: GitHubRepo.commitMessage("add_agenda_item", title) });
  return { path, call_date: callDate, share: id || null, files: prepared.map((f) => f.path) };
}

/** MCP-AGENDA-003, MCP-AGENDA-004 */
export async function listAgenda({ repo, now = new Date(), week } = {}) {
  const callDate = week ?? nextCallDate(JSON.parse(await readText(repo, "config.json")), now);
  const prefix = `agenda/${callDate}/`;
  const tree = await repo.listTree();

  const items = [];
  for (const entry of tree.filter((e) => e.type === "blob" && e.path.startsWith(prefix))) {
    const text = await readText(repo, entry.path);
    const { data, body } = parseFrontmatter(text);
    // MCP-AGENDA-003: the item answer is title, author, added, link plus the share ids,
    // with the note as body. Files stay in the share, reachable through `share`.
    items.push({
      path: entry.path,
      title: data.title ?? entry.path.slice(prefix.length, -3),
      author: data.author ?? "",
      added: data.added ?? "",
      link: data.link ?? "",
      summary: body.trim(),
      share: data.share ?? "",
      files: toList(data.files),
      repo_url: data.repo_url ?? "",
    });
  }

  // Newest first, and the path is the tie-breaker so the order is stable for one stamp.
  items.sort((a, b) => (a.added < b.added ? 1 : a.added > b.added ? -1 : a.path < b.path ? -1 : 1));
  return { call_date: callDate, items };
}

/** MCP-PROJ-001, MCP-SHARE-001 */
export async function shareProject({ repo, login, now = new Date(), name, status = "", summary = "", links, files, repo_url }) {
  const prepared = prepareFiles(files);
  assertClean([{ path: "summary", content: summary }]);

  const id = prepared.length > 0 ? shareId(login, now) : "";
  // MCP-PROJ-001: the upsert needs a path that is stable across re-shares, so the base
  // form of the slug is what names the file.
  const path = projectPath(login, slugBase(name));
  const content = writeFrontmatter(
    {
      name,
      status,
      author: login,
      updated: now.toISOString(),
      links: normalizeLinks(links),
      share: id,
      files: prepared.map((f) => f.path),
      repo_url,
    },
    summary,
  );

  for (const file of prepared) {
    await repo.writeFile(sharePath(id, file.path), file.content, {
      message: GitHubRepo.commitMessage("share_project", file.path),
    });
  }
  await repo.writeFile(path, content, { message: GitHubRepo.commitMessage("share_project", name) });

  return { path, name, share: id || null, files: prepared.map((f) => f.path) };
}

/** MCP-PROJ-002, MCP-PROJ-003 */
export async function getProjects({ repo, author, query } = {}) {
  const tree = await repo.listTree();
  const want = String(query ?? "").toLowerCase();

  const projects = [];
  for (const entry of tree.filter(isProjectBlob)) {
    // projects/<login>/<slug>.md -> two sources for the author: the folder name and the
    // frontmatter. The frontmatter is what the writer set, so it answers first.
    const [, login = ""] = entry.path.split("/");
    const { data, body } = parseFrontmatter(await readText(repo, entry.path));
    const project = {
      name: data.name ?? fileOf(entry.path),
      author: data.author || login,
      status: data.status ?? "",
      updated: data.updated ?? "",
      summary: body.trim(),
    };
    // Both filters are substring tests so a partial login is enough to narrow the screen.
    if (author && !project.author.includes(author)) continue;
    if (want && !`${project.name}\n${project.summary}`.toLowerCase().includes(want)) continue;
    // MCP-PROJ-002: exactly these five fields, so the file list never reaches the caller.
    projects.push(project);
  }
  return projects;
}

/** MCP-SHARE-003 */
export async function pullShare({ repo, share_id }) {
  const prefix = `${SHARE_PREFIX}${share_id}/`;
  const files = [];
  for (const entry of (await repo.listTree()).filter((e) => e.type === "blob" && e.path.startsWith(prefix))) {
    files.push({ relPath: entry.path.slice(prefix.length), content: await readText(repo, entry.path) });
  }
  return { share_id, files };
}

/** MCP-RECAP-001 */
export async function logRecap({ repo, login, now = new Date(), call_date, recap }) {
  const path = recapPath(call_date);
  await repo.writeFile(
    path,
    writeFrontmatter({ author: login, logged: now.toISOString(), call: call_date }, recap),
    { message: GitHubRepo.commitMessage("log_recap", call_date) },
  );
  return { path, call_date };
}

function isProjectBlob(entry) {
  return entry.type === "blob" && entry.path.startsWith("projects/") && entry.path.endsWith(".md");
}

// The slug is the fallback identity when a file carries no `name:` line.
function fileOf(path) {
  return (path.split("/").at(-1) ?? "").replace(/\.md$/, "");
}

// A list key is JSON when the writer produced it and a bare string when it was hand-edited.
function toList(value) {
  return Array.isArray(value) ? value : [];
}

// `links` may arrive as an array or as one already-serialized JSON array.
function normalizeLinks(links) {
  if (Array.isArray(links)) return links;
  if (typeof links === "string" && links.trim().startsWith("[")) return JSON.parse(links);
  return links ?? [];
}
