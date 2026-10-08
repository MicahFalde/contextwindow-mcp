# The Context Window MCP package

Area code: `MCP`
Owner: Micah

The local MCP server members add to Claude Code. It reads and writes the private data repo
`MicahFalde/contextwindow` through the GitHub Contents API as the member. One `shall` per
requirement. IDs are permanent. Spec: `../SPEC.md`.

Verify modes: `test` · `human` (carries `reviewed:`) · `retired`.

---

## AUTH — who the member is

### MCP-AUTH-001
When the server starts, the system shall obtain a GitHub token from `GITHUB_TOKEN` if set,
else from `gh auth token`.
- verify: test
- tests: tests/auth.test.mjs

### MCP-AUTH-002
If no GitHub token can be obtained, then the system shall return a tool error naming both
sources without attempting any GitHub call.
- verify: test
- tests: tests/auth.test.mjs

### MCP-AUTH-003
When a write is made, the system shall record the author as the GitHub login resolved from
the token, never from a tool argument.
- verify: test
- tests: tests/auth.test.mjs

## GIT — how the repo is written

### MCP-GIT-001
The system shall write every item as its own file, never appending to a shared file.
- verify: test
- tests: tests/paths.test.mjs

### MCP-GIT-002
If a write fails with HTTP 409 or 422 because the file SHA is stale, then the system shall
refetch the file and retry the write up to three times before returning an error.
- verify: test
- tests: tests/github.test.mjs

### MCP-GIT-003
When a file is written, the system shall commit it with a message of the form
`<tool>: <title>` so the repo history reads as a log.
- verify: test
- tests: tests/github.test.mjs

### MCP-GIT-004
The system shall read the data repo name from `CONTEXTWINDOW_REPO`, defaulting to
`MicahFalde/contextwindow`.
- verify: test
- tests: tests/github.test.mjs

## AGENDA — items for the next call

### MCP-AGENDA-001
When `add_agenda_item` is called with a title, the system shall write
`agenda/<call-date>/<slug>.md` with frontmatter (title, author, added, link) and the note as
body.
- verify: test
- tests: tests/agenda.test.mjs

### MCP-AGENDA-002
When `add_agenda_item` is called without a `call_date`, the system shall compute the next
call date from `config.json` in the data repo (`callWeekday`, `timezone`), choosing the
following week when today is the call day and the call time has passed.
- verify: test
- tests: tests/agenda.test.mjs

### MCP-AGENDA-003
When `list_agenda` is called without arguments, the system shall return the items for the
next call date, newest first, with author and link.
- verify: test
- tests: tests/agenda.test.mjs

### MCP-AGENDA-004
When `list_agenda` is called with `week`, the system shall return that call date's items.
- verify: test
- tests: tests/agenda.test.mjs

### MCP-AGENDA-005
The slug for an item shall be the title lowercased, non-alphanumerics collapsed to single
hyphens, trimmed to 60 characters, with a 4-character suffix from the timestamp so two
members adding the same title never collide.
- verify: test
- tests: tests/paths.test.mjs

## PROJ — what each member is building

### MCP-PROJ-001
When `share_project` is called, the system shall write `projects/<login>/<slug>.md` with
frontmatter (name, status, author, updated, links) and the summary as body, replacing any
existing file at that path.
- verify: test
- tests: tests/projects.test.mjs

### MCP-PROJ-002
When `get_projects` is called, the system shall return every project's name, author,
status, updated date and summary, with no attached files.
- verify: test
- tests: tests/projects.test.mjs

### MCP-PROJ-003
When `get_projects` is called with `author` or `query`, the system shall return only the
projects matching that login or containing the query in name or summary.
- verify: test
- tests: tests/projects.test.mjs

## SHARE — code and files, opt in

### MCP-SHARE-001
When `add_agenda_item` or `share_project` is called with a `files` list, the system shall
write each file under `shares/<share-id>/<original path>` and record the share id and file
list in the item's frontmatter.
- verify: test
- tests: tests/shares.test.mjs

### MCP-SHARE-002
If a share exceeds 25 files, 250 KB in any one file, or 2 MB in total, then the system
shall reject the whole share with an error naming the limit, writing nothing.
- verify: test
- tests: tests/shares.test.mjs

### MCP-SHARE-003
When `pull_share` is called with a share id, the system shall return every file in that
share with its original relative path and content.
- verify: test
- tests: tests/shares.test.mjs

### MCP-SHARE-004
The descriptions of `add_agenda_item` and `share_project` shall state that `files` is
attached only when the member explicitly asks to share code, and that `repo_url` is the
route for anything larger than the limits.
- verify: test
- tests: tests/tools.test.mjs

### MCP-SHARE-005
If a `files` entry has a path containing `..`, a leading `/`, or a `.env` basename, then the
system shall reject the whole share.
- verify: test
- tests: tests/shares.test.mjs

## SCAN — credentials never leave the machine

### MCP-SCAN-001
When any content is about to be written, the system shall scan it for private key blocks,
AWS access keys, GitHub tokens, Slack tokens, Google API keys, Stripe keys, JWTs, and
`KEY=value` lines whose value has Shannon entropy above 4.0 bits per character and length
over 20.
- verify: test
- tests: tests/scan.test.mjs

### MCP-SCAN-002
If the scan finds a match, then the system shall reject the whole write with the file path,
line number and rule name for every match, never the matched value.
- verify: test
- tests: tests/scan.test.mjs

### MCP-SCAN-003
The scan shall run before any network call, so rejected content is never transmitted.
- verify: test
- tests: tests/scan.test.mjs

## RECAP — after the call

### MCP-RECAP-001
When `log_recap` is called, the system shall write `recaps/<call-date>.md` with frontmatter
(author, logged) and the recap as body, replacing any existing recap for that date.
- verify: test
- tests: tests/recap.test.mjs

## PROMPT — slash commands

### MCP-PROMPT-001
The system shall expose a `prep` prompt that instructs Claude to read the last seven days of
`git log` in the current directory, ask the member what else they did, draft a three-sentence
roundtable item, ask whether to attach any code, and call `add_agenda_item` only after the
member approves.
- verify: test
- tests: tests/prompts.test.mjs

### MCP-PROMPT-002
The system shall expose a `brief` prompt that instructs Claude to call `list_agenda` and
`get_projects` and present both as one screen grouped by member.
- verify: test
- tests: tests/prompts.test.mjs

## NFR

### MCP-NFR-001
The package shall start and answer `tools/list` over stdio within 2 seconds on Node 20 or
later with no network access.
- verify: test
- tests: tests/server.test.mjs

### MCP-NFR-002
The package shall have no runtime dependency other than `@modelcontextprotocol/sdk` and `zod`.
- verify: test
- tests: tests/server.test.mjs
