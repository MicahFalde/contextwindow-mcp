# The Context Window MCP

The MCP server members of The Context Window add to Claude Code. It gives Claude six tools
(`add_agenda_item`, `list_agenda`, `share_project`, `get_projects`, `pull_share`, `log_recap`)
and two slash-command prompts (`/mcp__contextwindow__prep`, `/mcp__contextwindow__brief`).

Everything it reads and writes lives in the private data repo `MicahFalde/contextwindow`,
through the GitHub API, as you. If you are not a collaborator there, every call fails. This
repo is only the program.

## Install

You need Node 20+ and a GitHub login: either `gh auth login` once, or `GITHUB_TOKEN` in your
environment with access to the data repo.

```
claude mcp add -s user contextwindow -- npx -y github:MicahFalde/contextwindow-mcp
```

Then in any Claude Code session: "add an agenda item about ...", "what is everyone working on",
or `/mcp__contextwindow__prep` before the call.

## Sharing code

Files are attached only when you ask. Limits: 25 files, 250 KB per file, 2 MB per share; use
`repo_url` for more. Anything that looks like a credential is rejected on your machine before
it is sent.

## Develop

```
npm install
npm test
npm run check   # requirement trace
```
