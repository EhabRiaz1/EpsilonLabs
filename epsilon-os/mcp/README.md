# Epsilon MCP

A Claude Code session opened in a client's project folder (`cd ~/Desktop/FP\&LM/fabricportApp && claude`) can find
that project's tickets, work them, and report back. Stdio MCP server, official `mcp` SDK (FastMCP, v1 line), httpx.

## How it is wired

- **Token**: one project token per project and Mac, made in admin (client -> project card -> **Connect Claude
  Code**). Shown once (`eps_pt_` + 64 hex), stored only as a sha256, revocable there, and scoped to that one
  project. It acts as the staff member who created it, so it can never do more than that person, and it stops
  working if they stop being staff. It can never approve anything (briefs, plans, merges, invoices, publishing).
- **Calls**: the server uses only the public anon / publishable key and passes the token as the first argument of
  the `mcp_*` database functions (migration `017_project_tokens.sql`). Each call checks the token, the project, the
  creator's staff rights and a rate limit of 600 calls per hour per token. There is no service key anywhere.
- **Audit**: every write is in `actions` with agent `claude_code` and `detail.via = "Claude Code · <project>"`.

## Tools

| Tool | What it does |
| --- | --- |
| `whoami` | Project, client, folder; warns when the session's folder is not the project's folder |
| `list_tickets(status="open")` | open / closed / all / one status |
| `get_ticket(ref)` | request (UNTRUSTED, wrapped in markers), full thread incl. internal notes and drafts, file names, approved brief and plan, time logged |
| `add_note(ref, body)` | internal note |
| `set_status(ref, status)` | triaged, in_progress, review, done (the client sees the label, unless the ticket is internal) |
| `log_time(ref, minutes, note, billable=True, worked_on=None)` | time entry |
| `reply(ref, body, send=False)` | DRAFT for the founder by default; `send=True` only when the user explicitly says to send |
| `create_ticket(title, body, type, priority, client_visible=False)` | new EL-n ticket, internal by default |
| `draft_update(title, body_md)` | update draft for the founder to publish |

Drafted replies show on the admin ticket page as "Claude Code draft" with **Send as reply** and **Edit & send**.

## Setup (once per Mac)

```sh
cd ~/dev/epsilon-labs/epsilon-os
make setup                      # or: .venv/bin/python -m pip install -r requirements.txt
mcp/install.sh                  # installs the skill to ~/.claude/skills/epsilon-tickets, prints the command
```

## Connect a project

1. Admin -> Clients -> the client -> the project card -> **Connect Claude Code** -> label (e.g. "Ehab's MacBook")
   -> **Create token**. Copy the command it shows (token, anon key and paths filled in). It is shown once.
2. In the project folder run that command, e.g.

   ```sh
   cd ~/Desktop/FP\&LM/fabricportApp
   claude mcp add epsilon \
     --env EPSILON_PROJECT_TOKEN=eps_pt_... \
     --env EPSILON_SUPABASE_ANON_KEY=<publishable key> \
     -- ~/dev/epsilon-labs/epsilon-os/.venv/bin/python ~/dev/epsilon-labs/epsilon-os/mcp/run.py
   ```

   Keep the default `local` scope: it stores the token in your own Claude Code config for this folder. Never use
   `--scope project`, which would write the token into the client's repo (`.mcp.json`).
3. `claude` in that folder, then "work the tickets" (or `/tickets`).

Optional env: `EPSILON_SUPABASE_URL` (defaults to the Epsilon project URL).

Revoke a token in the same sheet; the next call from that Mac fails with "invalid or revoked project token". Then
`claude mcp remove epsilon` in the folder.

## Tests

`make test` runs `tests/test_epsilon_mcp.py` (fake PostgREST) and `tests/test_project_tokens_migration.py` (local
Postgres; skipped when none is running).
