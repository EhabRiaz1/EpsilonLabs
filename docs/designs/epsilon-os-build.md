# Epsilon OS — build plan (eng review 2026-10-10)

Source decisions: PLAN.md §3.4 (agent stack), epsilon-os/README.md, agent
runbooks in `epsilon-os/agents/`, golden set in `epsilon-os/evals/`.
**Founder decision 2026-10-10:** build the whole OS now (all agents, dashboard,
brief, scheduling) instead of PLAN.md's volume-trigger gating. The autonomy
ladder is unchanged: every external message is founder-approved.

## Decisions locked in this review

| # | Decision |
|---|---|
| D1 | Full OS on **one shared core**. Concierge + reply triage merge into one `inbox` agent with two modes (they share mail-loop rules, classifier and suppression handling). |
| D2 | **Code pipeline, tool-less AI.** Python does all IMAP/SMTP/DB/rule work. Claude is called through the API with no tools, returns strict JSON validated by code. The model never sees credentials and cannot act. Prospector may use the read-only web-search server tool. Replaces `claude -p` + runbooks (README:8). Runbooks become prompt sources. |
| D3 | **Dashboard local on the Mac** (`http://127.0.0.1:8787`, launchd-started, service key from keychain, bound to loopback only). No login, nothing internet-facing. |
| D4 | **Outbox state machine.** Drafts carry kind/recipient/subject/thread; `pending → approved/edited_approved → sending → sent | failed`, atomic claim, Zoho SMTP, sent Message-ID recorded. |
| D5 | **Pinned venv**: `epsilon-os/.venv` from `/usr/local/bin/python3.12`, `requirements.txt` pinned; every launchd job and test uses the venv python by absolute path. |
| D6 | **Migration `epsilon_os_v2`**: outbox columns + `actions` (append-only audit log) + `dossiers`. Additive only. |
| D7 | **Golden set runnable**: fixtures + scorer (`make eval`) against the real API, thresholds enforced (100% opt-out/injection, ≥90% routing). Hardened by D12. |
| D8 | **Mail E2E** against an in-process fake IMAP/SMTP + local Postgres with the schema; plus one live Zoho smoke (`make smoke`: er@ → er@) before go-live. |
| D9 | **Tiered models + daily cap**: Haiku 5.5 classify/score; Sonnet 5.5 drafts, dossiers, quotes, brief. Tokens + cost per call in `actions`; daily $ cap halts agents with a red health warning. |
| D10 | **External watchdog**: every agent run pings healthchecks.io (free); no ping for 30 min in PKT working hours alerts the founder off-Mac. Inbound acks older than 2h get a "late" badge. |
| D11 | **Deterministic draft lint** on every AI draft: new URLs, email addresses, phone/IBAN/bank patterns, prices outside offers.py bands, refund/guarantee promises → red warning + second-click approve. Golden set gains draft-safety cases. |
| D12 | **Eval hardened** (supersedes D7's hook): temperature 0, each fixture ×3 (all must pass), set grows to ~40 (≥6 opt-out, ≥10 injection; founder reviews additions). Pre-commit hook warns on prompt changes; autonomy promotion hard-requires a clean run. |
| D13 | **Precision**: Zoho Message-ID spike is step 0; claim = PostgREST filtered PATCH `status=in.(approved,edited_approved)` with `Prefer: return=representation` (row returned ⇒ owned); all business-time logic in Asia/Karachi; prospector built last. |
| — | Existing D7 (outreach domain): `outbound` drafts are never sent from er@; they wait for the outreach-domain sender (PLAN T9). |

## Architecture

```
                       launchd (absolute venv python)
   ┌──────────────┬───────────────┬──────────────┬─────────────┬───────────┐
   │ inbox  */5m  │ outbox  */1m  │ prospector   │ brief 08:30 │ backup    │
   │ (concierge + │ (claim→SMTP)  │ (Mon-Fri AM) │             │ (Sun 02:00)│
   │  triage)     │               │              │             │           │
   └──────┬───────┴──────┬────────┴──────┬───────┴──────┬──────┴─────┬─────┘
          │              │               │              │            │
          ▼              ▼               ▼              ▼            ▼
   ┌─────────────────────────── core/ (shared) ───────────────────────────┐
   │ config (keychain/.env) · db (PostgREST via httpx, service key)        │
   │ mail (imaplib/smtplib, Zoho) · guard (deterministic mail-loop rules, │
   │ suppression) · llm (tool-less API, JSON schema validate, cost cap)   │
   │ ledger (actions + heartbeats) · offers (reads catalogue.json)        │
   └───────────────────────────────┬───────────────────────────────────────┘
                                   ▼
                        Supabase Postgres (RLS: service_role only)
                                   ▲
          dashboard (127.0.0.1:8787): pipeline · approval queue · health
```

### Inbound flow (inbox agent)

```
IMAP fetch new UIDs ─► parse headers/body ─► dedupe (touches.message_id unique)
   │
   ▼
guard (CODE, never the model):
   Auto-Submitted≠no / Precedence bulk|list|junk / OOO pattern ─► touch auto_reply, no draft
   bounce patterns ─► touch bounce; hard bounce ─► suppression
   own address / acked same thread <24h ─► log only
   sender suppressed ─► log only
   │ (passes)
   ▼
llm.classify (Haiku, body inside <untrusted> block, JSON only)
   label ∈ {inquiry, opt_out, injection_suspected, auto_reply, bounce}, wedge, flags
   │
   ├─ opt_out ─► suppression + contacts.opted_out (code, immediate) + 1 confirmation draft
   ├─ injection_suspected ─► touch flagged, founder alert, normal reply only if quoted
   └─ inquiry ─► upsert company/contact/deal (source_channel) ─► ack draft (template)
                 + llm.draft (Sonnet) substantive reply ─► approval_queue (pending)
```

### Outbox state machine

```
pending ──approve──► approved ──┐
   │   ──edit+approve► edited_approved ──┤
   │                                     ▼
   ├──reject──► rejected         claim: UPDATE … SET status='sending'
   └──48h──► expired             WHERE id=? AND status IN (approved, edited_approved)
                                  (row count 1 = we own it)
                                         │
                              SMTP send (Message-ID pre-generated & stored first)
                                 ├─ ok ──► sent (+ touch 'sent', sent_message_id)
                                 └─ err ─► failed (+ send_error; dashboard retry → approved)
   kind='outbound' is refused by the er@ sender (waits for outreach domain).
   Crash in 'sending' > 10 min ─► dashboard shows "check Sent folder" (IMAP lookup by
   pre-stored Message-ID decides sent vs failed; never blind resend).
```

## Components and files

```
epsilon-os/
  requirements.txt, Makefile (setup, test, eval, smoke, install-jobs)
  migrations/002_epsilon_os_v2.sql
  core/  config.py db.py mail.py guard.py llm.py ledger.py offers.py
  agents/ inbox.py outbox.py prospector.py quote.py brief.py backup.py
  prompts/ classify.md draft_reply.md ack.md dossier.md outbound.md quote.md brief.md
           (runbook text + the four hard rules, single shared preamble file)
  dashboard/ app.py (stdlib http.server + Jinja-free templates) static/
  launchd/ co.epsilon-labs.os.<agent>.plist  + install script
  evals/ golden/E01..E20.eml + expected.json, run_eval.py
  tests/ unit + e2e (fake_mail.py fixture, local Postgres fixture)
```

## Migration epsilon_os_v2 (additive)
- `approval_queue`: `kind` (ack|reply|outbound|quote|optout_confirm), `to_email citext`,
  `subject`, `in_reply_to_message_id`, `references`, `send_error`, `sent_message_id`,
  `claimed_at`, `run_id`.
- `approval_status`: add `sending`, `failed`.
- `actions`: id, at, agent, run_id, action, target_table, target_id, detail jsonb,
  model, input_tokens, output_tokens, cost_usd. Insert-only (no update/delete policy).
- `dossiers`: id, company_id fk, version, body_md, sources jsonb, created_at, created_by.
- RLS service_role-only on both new tables.

## Test requirements (pytest; written with the code)
Every path in the review's coverage map gets a test. Highlights:
- guard: one test per rule branch, true AND false path; header-less OOO; own-address.
- llm: invalid JSON, extra keys, wrong enum → rejected + flagged; timeout/429 retry;
  daily cap reached → no call, heartbeat warn.
- outbox: two concurrent claimers → one send; SMTP auth fail/timeout → failed + error;
  outbound kind refused; stale `sending` resolution by Message-ID.
- E2E (fake mail + local PG): inbound → ack draft → approve → sent; duplicate fetch;
  opt-out end-to-end; double approve; edit-then-approve sets material_edit.
- eval: golden set thresholds (D7), run on prompt change.
- brief: zero-data render; silent agent > threshold → red health block.
- backup: dump → restore to scratch DB → row counts match.
- launchd: job command uses absolute venv path (static check on plist files).

## Failure modes
| Path | Realistic failure | Test | Handling | User sees |
|---|---|---|---|---|
| inbox IMAP | Zoho app password revoked | yes | heartbeat error | red health block in brief + dashboard |
| inbox classify | model returns prose not JSON | yes | reject, flag, no draft | flagged item in queue |
| outbox | Mac sleeps mid-send | yes | `sending` + Message-ID lookup | "verify" badge, no blind resend |
| outbox | SMTP 535 auth | yes | `failed` + error | failed row with reason, retry button |
| prospector | web page with injected instructions | eval | tool-less, quoted only | dossier flagged |
| quote | figure outside offers.py band | yes | no draft, flag | flag in queue |
| brief | brief job itself dies | yes (absence) | none possible in-process | missing 9am brief IS the alarm (PLAN §3.4) |
| launchd | Mac off for a day | yes | catch-up single run on wake | brief notes gap |
| cost | runaway loop | yes | daily cap halts | red health warning |
| Mac | asleep / power cut | n/a | external watchdog (D10) | phone/email alert within 30 min |
| draft | injected link or bank detail | yes + eval | draft lint (D11) | red warning, second-click approve |
No critical gaps: every failure has a test, handling, or a visible signal.

## Build order (CC estimates)
0. Zoho spike: send er@→er@ with a pre-generated Message-ID, confirm it survives in Sent + inbox (~1h; blocks the outbox design)
1. venv + core + migration v2 + tests (~0.5 day)
2. inbox + outbox + draft lint + hardened golden-set eval + fake-mail E2E (~1.25 day)
3. dashboard (~0.5 day)
4. brief + heartbeats + watchdog + backup + launchd install (~0.5 day)
5. quote assembler (~0.25 day)
6. Zoho live smoke, go-live at stage 2 (founder-approved) (~1h)
7. prospector + dossiers (~0.5 day; its outbound drafts wait for the outreach domain)

Guardrail: the build never blocks the cash play. Referral asks go out by hand this week regardless of build state.

## Founder prerequisites
Zoho IMAP enabled + app password in keychain (`epsilon-os-zoho`); Anthropic API key
in keychain (`epsilon-os-anthropic`); Supabase service key in keychain
(`epsilon-os-supabase`); review the golden set (founder-only per PLAN §6).

## NOT in scope
- Hosted/phone dashboard — local by D3; revisit with server migration (TODOS P2).
- Sending outbound from er@ — forbidden by D7; needs outreach domain + sending tool (PLAN T9).
- Auto-send of anything — autonomy ladder unchanged; promotion needs eval + 20 clean runs.
- Multi-tenant / resale packaging — TODOS P3.
- Gmail OAuth path — superseded by Zoho IMAP/SMTP.

## What already exists (reused)
- `epsilon-os/schema.sql` (applied as `epsilon_os_init`) — extended, not rebuilt.
- Agent runbooks — become the prompt sources; the duplicated hard-rules block becomes one shared preamble.
- `epsilon-os/evals/golden-set.md` — converted to fixtures, content kept.
- `tools/offers.py` → `catalogue.json` (tools/agent.py) — quote bands read from it, not re-typed.
- `touches_message_id_uq` unique index — dedupe for IMAP re-fetch.
- `is_suppressed()` SQL function — guard calls it.

## Implementation Tasks
- [ ] **T1 (P1, human: ~1h / CC: ~15min)** — outbox — Zoho Message-ID spike (D13)
- [ ] **T2 (P1, human: ~1d / CC: ~4h)** — core — venv 3.12, core modules, migration epsilon_os_v2 (D4, D5, D6)
- [ ] **T3 (P1, human: ~2d / CC: ~6h)** — inbox — concierge+triage agent, code guard, tool-less classify (D1, D2)
- [ ] **T4 (P1, human: ~1.5d / CC: ~3h)** — outbox — state machine with atomic claim (D4, D13)
- [ ] **T5 (P1, human: ~4h / CC: ~45min)** — safety — deterministic draft lint (D11)
- [ ] **T6 (P1, human: ~1d / CC: ~2h)** — eval — hardened runnable golden set (D7, D12)
- [ ] **T7 (P2, human: ~2d / CC: ~4h)** — dashboard — local, 127.0.0.1 (D3; design review first)
- [ ] **T8 (P2, human: ~1d / CC: ~3h)** — ops — brief, heartbeats, watchdog, backup, launchd (D10)
- [ ] **T9 (P2, human: ~3h / CC: ~30min)** — cost — tiered models + daily cap (D9)
- [ ] **T10 (P2, human: ~1d / CC: ~2h)** — quote — assembler from catalogue.json bands
- [ ] **T11 (P2, human: ~2d / CC: ~4h)** — prospector — prospector + dossiers, built last
- [ ] **T12 (P2, human: ~2d / CC: ~4h)** — tests — pytest suite, fake-mail E2E, Zoho smoke (D8)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAN | Growth plan (PLAN.md); founder later overrode volume gating to build full OS |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | ISSUES (claude subagent) | 10 findings; 6 accepted as D10–D13, 3 scope points held by founder decision, 1 partly stale |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 12 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | dashboard design review requested next |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**CROSS-MODEL:** Outside voice agreed on architecture; tension on scope (it argued for gating the build behind the cash play) resolved by founder decision to build all now, with a guardrail that the build never blocks referral sends. D7 eval hook superseded by D12.

**VERDICT:** CEO + ENG CLEARED — ready to implement after the dashboard design review.

NO UNRESOLVED DECISIONS
