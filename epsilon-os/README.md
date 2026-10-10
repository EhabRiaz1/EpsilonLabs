# Epsilon OS

Epsilon Labs' internal agent layer (PLAN.md §3.4). Product-grade means: logged actions, one dashboard, restorable state, demoable. Not multi-tenant, not packaged for resale. Design record: `docs/designs/epsilon-os-build.md`.

This directory is code and docs only. It is excluded from the Vercel deployment (`.vercelignore`). No secrets live here; they come from the macOS keychain via `core.config.secret`.

## How it runs
- Local-first on the founder's Mac [D8]. Python does every action; the model only classifies and drafts. Each LLM call is a tool-less local Claude Code session (`claude -p --tools ""`, D2a) with output checked against a JSON schema, counted against a daily call budget (Settings `llm.daily_budget`, default 250, D9). The one exception is prospector research, which also gets WebSearch and WebFetch and nothing else (P4).
- Mail: Zoho IMAP (`imappro.zoho.com`) in, Zoho SMTP (`smtppro.zoho.com`) out, as `er@epsilon-labs.co`. Nothing is sent without founder approval in the dashboard.
- Store: Supabase Postgres over PostgREST (`schema.sql` + `migrations/`). RLS blocks everything but the service role.
- Agents: `inbox` (every 5 min), `outbox` (every 60 s), `brief` (08:30 daily), `backup` (Sunday 02:00). All go through `python -m agents.run <name>`: a per-job lock prevents overlap, any exception becomes a heartbeat `error` (exception type only) and a non-zero exit.
- Prospecting (P1-P5): `prospector` (07:00 daily, `python -m agents.run prospector`) researches companies with a public, current, unmet need and queues dossiers plus a first-touch draft (kind `outbound`) for approval. `outreach` (every 5 min) sends approved outbound mail from the separate outreach mailbox, capped by `min(Settings daily cap, warm-up ramp)`. It does nothing until Settings `outreach.address` is set and the keychain item below exists. `inbox` also reads that mailbox in triage mode. Volume, segments, pause and caps live on the dashboard Settings page (`/settings`, table `settings`, migration 004). Dry run: `python -m agents.prospector --dry-run --segment industrial --n 3` (real research, fake DB, writes nothing).
- The `brief` (no LLM, deterministic) opens with a health block. A missing brief by 9am PKT is itself the alarm.
- The launchd calendar jobs use the Mac's local clock, so the Mac must be set to PKT (Asia/Karachi) for 08:30 to mean 08:30 PKT.

## Keychain items
| Service | Account | Holds |
|---|---|---|
| `epsilon-os-supabase-secret` | Supabase project ref | service-role key |
| `epsilon-os-zoho` | `er@epsilon-labs.co` | Zoho app password |
| `epsilon-os-healthchecks` | `ping-url` | healthchecks.io ping URL |
| `epsilon-os-outreach` | the outreach address (Settings `outreach.address`) | outreach mailbox app password |

Add one with `security add-generic-password -a <account> -s <service> -w` (prompts for the value, so it stays out of shell history).

## Commands
`make setup` (venv, pinned deps) · `make test` · `make dashboard` (http://127.0.0.1:8787) · `make run-agent A=brief` · `make eval` / `eval-quick` (real `claude` calls) · `make smoke ARGS=--i-mean-it` (live, needs consent) · `make jobs-install` / `jobs-uninstall` / `jobs-status` · `make backup-check D=<folder>`.

## Go live
1. `make setup && make test`
2. Watchdog: create a free check at healthchecks.io with period 5 min and grace 30 min, with email/phone alerts. Then `security add-generic-password -a ping-url -s epsilon-os-healthchecks -w` and paste the ping URL. Without it pings are a logged no-op.
3. `scripts/install_jobs.sh` validates plists, venv and `claude`, then bootstraps the agent jobs (inbox, outbox, brief, backup, prospector, outreach) (`--uninstall` removes them). The dashboard job (`launchd/co.epsilon-labs.os.dashboard.plist`) is installed separately and keeps its own RunAtLoad.
4. `scripts/status_jobs.sh` shows state and last log line per job. Logs: `~/Library/Logs/epsilon-os/<job>.log`.

## Autonomy ladder
1 shadow, 2 founder-approved, 3 auto-template-ack only, 4 auto on proven segments. Promotion needs the golden set (`evals/golden-set.md`: 100% opt-out + injection, >=90% routing) plus 20 consecutive clean approved runs. Re-run the golden set on every prompt change.

## Backups
Weekly `agents.backup` pages every table through PostgREST (no `pg_dump`; there is no DB password) into `~/EpsilonOS-backups/YYYY-MM-DD/<table>.jsonl` plus `manifest.json` (row counts, sha256). The newest 8 dated folders are kept. `make backup-check D=<folder>` verifies hashes and counts. Monthly manual drill: load a folder into a scratch Supabase project and compare row counts. A backup never restored is not a backup. `suppression_list` is in every export. The folder holds PII: keep it on an encrypted disk. Secret rotation runbook lives outside this repo (PLAN.md §3.1).

## Data policy (PLAN.md §3.4 [4A])
Suppression honored forever; 18-month retention for non-responders; UK/EU B2B legitimate interest with one-click opt-out.
