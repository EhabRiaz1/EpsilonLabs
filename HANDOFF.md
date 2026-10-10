# Session Handoff — Epsilon Labs (updated 2026-10-10, after Epsilon OS go-live)

Read PLAN.md §10a (current target) and docs/designs/epsilon-os-build.md (Epsilon OS decisions)
first. Memory files: epsilon-labs-growth-plan, ehab-founder-profile.

## Current target
$100k signed (stretch $150k) from NEW international clients by 2026-12-31 (PLAN §10a).
Founder works existing clients (Total Parco, Master Paints, YS Group, Areeb Areel...) himself.

## Epsilon OS — LIVE on the founder's Mac (launchd)
- Jobs: inbox 5m (er@ + outreach mailbox), outbox 1m, outreach 5m (+ hourly follow-ups),
  prospector daily 07:00 PKT, brief 08:30 PKT, backup Sun 02:00, dashboard 127.0.0.1:8787.
- Status: `epsilon-os/scripts/status_jobs.sh`; logs `~/Library/Logs/epsilon-os/`.
- Supabase migrations applied: epsilon_os_init, v2, v3, v4 (settings), v5 (sequences).
- Keychain: epsilon-os-zoho (er@), epsilon-os-outreach (ehab@epsilonlabs-hq.com),
  epsilon-os-supabase-secret, epsilon-os-healthchecks. Rotate per founder when convenient.
- LLM = local Claude Code `claude -p` (tool-less; research uses WebSearch/WebFetch only).
- Every external email is founder-approved in the dashboard Deck. Outreach warm-up ramp
  5/day +5 every 3 days (cap in /settings). Follow-ups day 4 / day 9, auto-stop on reply.
- Prospector targets US/CA/UK/IE/EU/CH/Gulf/AU/NZ/SG/JP/KR/IL only; packages in offers.py:
  plant-visibility-pilot $18k, hardware-rescue $20k, ops-software-build $22k.

## Research engine (2026-10-11)
- 8 prospector strategies (trigger events, regulation, partners, outsourcing intent, orphaned devices,
  trade-show exhibitors, crowdfunding trouble, accelerator cohorts) with quotas + learning loop
  (Settings / Health). 40 prospects/day, LLM budget 450. Markets = setting (PK + sanctioned excluded).
- Tenders job 06:00 PKT: TED, UK FTS/CF, CanadaBuys, AusTender, UNGM, World Bank, EBRD, SAM.gov (free key,
  ~10 calls/day); Gulf portals + ADB/AfDB/IsDB/AIIB shipped disabled (login/CAPTCHA/JS). Dashboard /opportunities.
- Migrations applied through v7 (006 opportunities, 007 strategy columns).

## Open items
- Founder: approve drafts daily in the Deck; LinkedIn outreach to contact-less prospects
  (dossiers in Pipeline); Wise/Payoneer + PSEB + services contract template; warm-contacts
  list for referral asks; review golden-set E21–E40; rotate the outreach + er@ passwords.
- Site: founder mid-edit (privacy/terms/cookies + styling). After that, run
  `scaffold.py && agent.py && sitemap.py && consistency.py` so the 3 packages get pages.
- Engine: prospect yield is ~9 drafts/day at 20 companies; many startups publish no email.
