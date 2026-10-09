# Epsilon OS

Epsilon Labs' internal agent layer (PLAN.md §3.4). Product-grade means: logged actions, one dashboard, restorable state, demoable. Not multi-tenant, not packaged for resale.

This directory is code and docs only. It is excluded from the Vercel deployment (`.vercelignore`). No credentials live here; use `.env` (gitignored) and the macOS keychain.

## How it runs
- Local-first on the founder's Mac [D8]: scheduled Claude Code sessions (cron/launchd invoking `claude -p` with the relevant runbook in `agents/`), one session per agent run.
- Supabase Postgres is the single store (`schema.sql`). Agents use the service-role key from the environment; RLS blocks everything else.
- Every run writes a row to `agent_heartbeats`. The daily CEO brief opens with a health block (last run per agent, unprocessed inbox count). A missing brief by 9am is the alarm.
- Drafts go to `approval_queue`. The founder approves; only then is anything sent.
- Graduates to a server only once auto-replies are trusted.

## Agents
| Agent | Runbook | Starts at | Built when |
|---|---|---|---|
| Prospector + CRM | `agents/prospector.md` | stage 2 | Sprint 0 |
| Inbound concierge | `agents/concierge.md` | stage 2 | week 3 |
| Reply triage | `agents/triage.md` | stage 1 | replies >10/wk |
| Quote assembler | `agents/quote.md` | stage 2 | quotes >4/mo |

Autonomy ladder: 1 shadow, 2 founder-approved, 3 auto-template-ack only, 4 auto on proven segments. Promotion needs the golden set (`evals/golden-set.md`: 100% opt-out + injection, >=90% routing) plus 20 consecutive clean approved runs. Re-run the golden set on every prompt change.

## Setup
1. Create a Supabase project (note the project URL and the service-role key from Settings > API).
2. Apply the schema: paste `schema.sql` into the SQL editor, or `psql "$DATABASE_URL" -f schema.sql`.
3. `cp .env.example .env` and fill in values. Keep `.env` out of git (already ignored). Prefer the keychain for the Gmail refresh token and the service-role key; the service-role key bypasses RLS, so never put it in the website or any client code.
4. Verify RLS: with the anon key, a select on any table must return nothing.
5. Create the Gmail OAuth credentials for er@ and the sending-tool key on the outreach domain; store in keychain/.env.
6. Run the golden set against the concierge prompt before it touches real mail.
7. Schedule the agents (launchd/cron) once the golden set passes at the stage they start at.

## Backup discipline
- Supabase daily backups enabled (verify the plan's retention; free tier backups may not exist, in which case rely on the exports below).
- Weekly export: `pg_dump "$DATABASE_URL" --no-owner -Fc -f backups/epsilon-os-$(date +%F).dump`, stored outside the repo (encrypted disk or private cloud folder), keep at least 8 weeks.
- Monthly restore test into a scratch project. A backup never restored is not a backup.
- Keep `suppression_list` in every backup; losing it risks emailing opted-out people.
- Secret rotation: 1-page rotation runbook per PLAN.md §3.1 (kept outside this repo).

## Data policy (PLAN.md §3.4 [4A])
Suppression honored forever; 18-month retention for non-responders; UK/EU B2B legitimate interest with one-click opt-out.
