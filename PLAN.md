# Epsilon Labs — Company Plan: Positioning, Automated Revenue Engine, and the Road to Security Systems

**Author:** Ehab Riaz (founder), reviewed via /plan-ceo-review (EXPANSION mode)
**Date:** 2026-10-09 (revised same day after adversarial review, 2 iterations)
**Horizon:** 90 days hard commitments · 6 months (Act 1) · 3 years ambition
**Companion:** `~/.gstack/projects/epsilon-labs/ceo-plans/2026-10-09-epsilon-growth-engine.md`
(vision + scope decisions; its funnel numbers and thresholds are canonical).

---

## 1. Where we actually are (honest baseline)

- One founder: BEng Electronics & Electrical Engineering. Proven, rare skill:
  reverse-engineering undocumented industrial protocols (eFuelPro: 25-byte
  frames @ 38400 8N1, BCD fields, no spec), full-stack from PCB → firmware →
  cloud → UI. Real machinery shipped. Real software systems in production.
- A finished, Anduril-inspired static site with 33 solution categories, 20+
  offers, llms.txt/JSON-LD agent layer, live demos. **The site is already
  capability-first** — the audit found the "too portfolio-ish" worry mostly
  unfounded. The real gaps: zero distribution, and no single 30-second
  "do-it-all" page.
- **epsilon-labs.co is unregistered; the site has never been deployed; the
  repo had no commits and has no remote.** (Decisions D6, 1A below fix this.)
- Revenue today: project-based, founder-sold, irregular. No pipeline system.

**The gap is not capability. It is distribution — plus foundations.**

## 2. The three-act thesis

- **Act 1 (months 0–6): Hybrid-automated services firm.** Agents do the 90%
  that is grunt work (research, enrichment, triage, instant acknowledgment,
  quote assembly, CRM hygiene); the founder does the 10% that converts
  (final copy, calls, delivery). Evidence basis: AI-research + human-copy
  hybrid outreach measured ~3x the reply rate of autonomous sending in 2026;
  referrals supply ~45% of consulting deals.
- **Act 2 (6–18 mo): Product revenue.** eFuelPro per-site monthly licences,
  Epsilon1 Design Package to OEMs. Hiring trigger (canonical): **≥$12k/mo
  trailing-30-day COLLECTED cash for 2 consecutive months** — collected,
  not invoiced: PK receivables run 60–90 days and we do not hire on paper
  [OV-4c].
- **Act 3 (18 mo–3 yr): Security systems company** — seeded early by the E2
  pilot (below), scaled only on a working reference.

$10–20k/mo is the Act-1-exit floor, not the goal. Every internal system is
built product-grade ("Epsilon OS") and becomes a sellable offer + case study.

## 3. Act 1 — the engine

### 3.1 Foundations (week 1) — from review findings
- Register epsilon-labs.co (~$30/yr) + Google Workspace for er@ (~$7/mo);
  deploy to Vercel (vercel.json exists). [D6]
- Private GitHub remote for this repo; commit everything; CRM SQLite file in
  nightly automated backup. [finding 1A]
- Secrets policy: all API keys (Gmail OAuth, sending tool, Claude, GitHub)
  in macOS keychain / env — never in the repo; 1-page rotation runbook. [4A]
- **Getting paid in USD [OV-4b]:** Payoneer and/or Wise Business set up and
  test-verified; PSEB registration (freelancer or company) for the IT-export
  tax regime; one simple services-contract template (scope, payment terms,
  IP transfer on payment). A USD deal cannot be signed before this exists.
- **Runway [OV-4a]:** founder states personal runway (months of living costs
  on hand) in the private CEO doc; if < 4 months, the plan's patience
  structure is invalid and short-cycle contract work takes priority. _(Fill
  in: ___ months.)_

### 3.2 Website repositioning (weeks 1–2, trimmed by review)
- The hero already leads to the problem finder ("→ What's broken") — keep.
- New **/capabilities/** page, **wedge-first [OV-2]:** the three wedges lead
  the page as "what we're known for"; the full range follows as "and
  everything between PCB and cloud." Specialist first impression, generalist
  depth intact; follows the existing slice grammar.
- `/work/` reframed from portfolio → proof-of-capability (each case ends
  with the categories it proves + "we can do this for you").
- Clear the README launch blockers: Epsilon1 photos, client logos, confirm
  Total Parco / YS facts.
- Keep the honesty rules (no fake scarcity, no credential claims, no
  published prices — deliberate; quote agent uses offers.py bands).

### 3.3 Channels and funnel (canonical numbers, segmented [OV-3])
Three wedges govern where we **hunt**; they do not govern what we **accept**:
profitable inbound work outside the wedges is taken when scope is ≤2 weeks
(revenue first — founder directive). Proactive effort stays inside:
1. **Fuel retail (PK now; Gulf = long-cycle seeding):** eFuelPro + forecourt
   automation. Gulf buyers run 6–12 month vendor-prequalification cycles —
   Dream-25 seeds them for months 4–12; **no 90-day closes expected.**
2. **Industrial monitoring/retrofits (PK):** mills, factories, generators,
   cold chain. **Primary 90-day revenue wedge** (with referrals).
3. **Remote protocol decode + firmware rescue (worldwide, USD):**
   **inbound/reputation channel, not outbound** — buyers appear only when
   already in pain, so cold email cannot time them. Served by war stories,
   public GitHub decode artifacts, and search presence; pays off months 4–9.

Channel motions:
- **Referral & partner program [E4]:** personal note + one-pager to every
  past client; fee = 10% of first-project invoice, paid when the client
  pays — **paid to firms and independent contacts only, never to employees
  inside a client or prospect company** (kickback exposure) [OV-6b]; 2–3
  partnerships with adjacent firms; quarterly agent-drafted "lab notes"
  email. 10–15 asks → 2–4 warm intros in 90 days.
- **Dream-25 [E5]:** 25 named dream accounts, ~8/mo, agent dossier +
  founder-personal artifact (default: a specific ops observation; teardown
  video / decoded sample frame reserved for the top ~5, one half-day/month
  from delivery capacity, flagged in the brief). 3–5 conversations by day 90.
  Mid-point check ~week 19: on-track assessment against the Act 2 trigger.
- **Outbound:** ~50 researched, founder-approved sends/week from week 5
  (after 3–4 week domain warm-up) on a separate outreach domain via a
  dedicated sending tool [D7], **aimed at PK industrial + fuel retail only**
  (wedge-3 outbound redirected to reputation-building per [OV-3]).
  300–400 sends in window × 0.6–1.5% interested-reply → 2–4 conversations.
- **War stories [E3]:** 2 technical write-ups/month, agent-drafted,
  founder-voiced, each ending in the matching offer. **Named venues
  [OV-6a]:** LinkedIn, Hacker News, r/embedded + r/PLC, and a public GitHub
  carrying decode artifacts; "distributed" = posted to ≥3 of these.
  0–2 conversations in window; this is wedge 3's primary channel and
  compounds after.

Funnel: ~8–14 conversations → 6–10 quotes → 30–40% close → 2–4 closes at
$2.5–6k avg — **expected from PK industrial + referrals; Gulf and worldwide
wedges are explicitly not counted in the 90-day window [OV-3].**
**Day-90 targets: expected ≥$3–4k/mo trailing-30-day closed (stretch
$6k/mo); ≥$15k qualified pipeline.** Every close is **tagged by source
channel [OV-4d]** (referral / outbound / Dream-25 / inbound / pre-existing
relationship) so the checkpoint tests the engine, not the founder's old
network. Miss protocol: below $3k closed AND $10k pipeline at day 90 →
assumptions falsified → replan ceremony; E2 and Dream-25 pause.
**Second-miss kill criterion [OV-6c]:** if the replanned engine also misses
at month 6, Act 1 ends — take contract work and reassess; no zombie mode.
The funnel's two load-bearing statistics (hybrid ≈3x autonomous replies;
referrals ≈45% of consulting deals) are **vendor-sourced directional
estimates [OV-6d]**, checked monthly against our own actuals.

### 3.4 The agent stack — Epsilon OS [E1, phased]
Local-first on the founder's Mac via scheduled Claude Code runs [D8];
graduates to a server only when auto-replies are trusted. Product-grade =
logged actions, one dashboard, restorable state, demoable — not multi-tenant.

Build order by volume trigger (payback order):
1. **Prospector + CRM** (Sprint 0) — Supabase Postgres from day one
   (founder decision 2026-10-10: Supabase for storage/auth/everything;
   replaces the SQLite phasing).
2. **Inbound concierge** on er@ (week 3) — pre-approved no-claims
   acknowledgment within minutes; substantive founder-approved reply same
   business day. Checks `Auto-Submitted`/`Precedence: bulk` headers and
   bounce patterns before acking; logs bounce / auto-reply / human as
   distinct CRM event types. [5A]
3. **Reply triage** — built only when replies >10/wk (NOT a day-45
   commitment).
4. **Quote assembler** — built only when quotes >4/mo; quotes assembled
   exclusively from offers.py bands.

**Security hard rules [3A]:** email bodies are data, never instructions; no
tool execution triggered by message content; untrusted text appears in
drafts only quoted, never obeyed; no secrets or other-client data in agent
context.

**Autonomy ladder + eval gate [6A]:** shadow → founder-approved →
auto-template-ack only → auto on proven segments. Promotion requires passing
a 20-email golden set (5 injection attempts, 3 auto-replies, 2 bounces,
1 opt-out): 100% on opt-out + injection, ≥90% routing — plus 20 consecutive
clean approved runs (drafts sent with no material founder edits). The eval
set re-runs on every prompt change.

**Observability [2A]:** every agent writes a heartbeat; the daily CEO brief
opens with a health block (last run per agent, unprocessed inbox count) and
weekly leading indicators (new conversations, quotes out, $ closed,
interested-reply rate, referral asks). A missing brief by 9am is itself the
alarm. Funnel assumptions reviewed monthly against actuals.

**Prospect data policy [4A]:** suppression list honored forever; 18-month
retention for non-responders; UK/EU outreach under B2B legitimate interest
with one-click opt-out; free data sources first ($0–100/mo enrichment line).

### 3.5 Compliance & deliverability
Separate outreach domain; SPF/DKIM/DMARC; tool-managed warm-up; volume caps;
founder approval on every external message — except the pre-approved
no-claims ack template, which is approved once — for the first 60 days
minimum (and until the eval gate passes); CAN-SPAM / UK PECR / GDPR
conformance.

## 4. E2 — Security beachhead pilot (the 4th track, gated)

- **Gate:** signed paid-pilot LOI from a named existing industrial/fuel
  customer by end of month 3, else E2 auto-moves to month 9. Pitch hours
  (months 1–3): 1h/wk inside the growth budget, folded into referral and
  Dream-25 touches with anchor candidates.
- **Pilot:** paid, target $2–5k + hardware at cost; 60–90 days, delivered
  months 4–8 at ≤4h/wk from delivery capacity (quoted lead times lengthen
  ~15%) plus a one-time 2–3 day field-install exception, flagged in the brief.
- **Success criteria:** ANPR read-rate ≥95% on site vehicles; zero missed
  perimeter events on a staged test set; ≥99% uptime over 30 consecutive
  days. **Converts into:** per-site monthly monitoring licence + rollout
  proposal for the customer's other sites.
- **Privacy stance:** customer is data controller; plates + timestamps only,
  no face recognition; on-prem storage default; 30-day retention; entrance
  signage; written data-handling annex ($200–500 legal, E2-gated budget);
  no public-space surveillance; no data resale.
- **Site-safety reality [OV-5a]:** fuel sites are explosive-atmosphere
  zones. Equipment placement respects Ex/ATEX zoning (devices outside
  hazardous zones or suitably rated); site permits and insurance/liability
  named in the pilot agreement. Prepared answers on Ex-zoning for the first
  site meeting.
- **Priority order [OV-5b]:** the pilot and the Act-2 revenue push compete
  for the same hours in months 5–6. Declared now: **the revenue trigger
  wins; the pilot stretches**, never the reverse.
- **Degraded mode [OV-5c]:** during the 2–3 day field install the Mac-based
  engine is offline: that week's outreach is pre-drafted and pre-approved,
  er@ gets an autoresponder, and the install is scheduled in a low-pipeline
  week flagged in the brief.
- Defense proper (radars, govt procurement, export-controlled work) remains
  a year-3 decision gated on recurring revenue, a team, and export counsel.

## 5. Budget (Act 1)

≤ ~$400/mo recurring (Workspace, sending tool, Claude API, prospect data)
+ ≤ $2,000 one-time (E2-gated hardware + legal). Domains ~$45/yr. No other
spend without a plan revision.

## 6. Founder-hours ledger (weekly)

Delivery ~30h (wedge projects + accepted short-scope inbound; in weeks with
no billable work these hours go to Dream-25, war stories, and referral
follow-ups — idle hours are redeployed, not lost [OV from #2]) · Growth
~10h (approvals 3.5, Dream-25 3, stories 2, referrals 0.5, E2 pitch 1) ·
Build review **~5h in weeks 1–6** (golden-set authoring is founder-only
work [OV-6e]), ~2h after · E2 post-gate 4h from delivery. Dream-25 pacing
is the shock absorber when a week busts.

## 7. What we will NOT do

- No autonomous mass sending (Approach C — rejected: ~3x worse replies,
  domain-ban risk). No publishing prices. No fake-urgency growth hacks.
- No paid ads until outbound + content prove message-market fit.
- No *proactive hunting* outside the three wedges during Act 1 — but
  profitable short-scope (≤2 week) inbound work is accepted from anywhere;
  focus governs where we hunt, not what we accept (founder directive).
- No defense-sector claims before team, track record, and counsel exist.
- No generic web-app/network pentesting (certification-gated; README rule
  stands).

## 8. Execution sprints (AI-compressed, 2026-10-10 revision)

Build-time is agent-time now (Fable 5 orchestrates; cheaper models run grunt
tasks). Only physics stays on calendar: domain warm-up (3–4 wks), buyer
reply latency, Gulf cycles. **Stack: Supabase (CRM/auth/storage) + Vercel
(deploy).** The CRM moves from SQLite to Supabase Postgres — same schema,
same backup discipline (Supabase daily backups + weekly export).

| Sprint | Deliverable | Who | Done means |
|---|---|---|---|
| S0 (0–48h) | Founder: domain, email, Wise/Payoneer. Agents: repo→private remote, site deployed, /capabilities/ + /work/ reframe, Supabase CRM schema, prospector v1, Dream-25 list, referral asks + network quotes DRAFTED | split | Site live; drafts in founder's approval queue |
| S1 (week 1) | **Cash play:** founder sends referral asks + quotes to every warm contact (deposit-upfront terms); concierge live on er@; first 8 dossiers; war story #1 + public GitHub; outreach domain warm-up STARTS; E2 pilot one-pager drafted | split | ≥1 deposit invoiced (target: few $k); asks logged |
| S2 (weeks 2–4) | War stories #2–3; dossiers 9–25; partner outreach; CEO brief live with health block; golden-set evals; quotes follow-ups | agents + 30–60 min/day founder | Pipeline ≥$15k qualified |
| S3 (week 5+) | Warm-up complete → 50 approved sends/wk (PK industrial); E2 LOI pitch to anchor candidates | split | Funnel checkpoint at day 90 unchanged: ≥$3–4k/mo collected (stretch $6k) — else miss protocol |

The day-90 *checkpoint* stays (it measures buyers, not us); everything we
control moves to S0–S1. E2 LOI decision stays month 3; second-miss kill
criterion stays month 6.

## 10a. Revised Q4 target: $100-150k signed from NEW clients (founder decision 2026-10-10, later)

Supersedes the $350k figure in §10 below, which stays as the record of the maths. The founder works
existing clients directly; Epsilon OS hunts new, international clients.

- **Target:** $100k signed by 2026-12-31 (base), $150k stretch, from clients found by the engine.
- **Maths:** deals need ~6 weeks to close, so outreach that counts for 2026 runs until ~2026-11-15.
  One warming mailbox sends ~1,125 emails by then (~375 people x 3-touch sequence). At $25k average
  deals and ~4% interested replies (signal-based targeting), that is ~15 conversations, ~9 proposals,
  ~3 closes = ~$75-100k; $150k needs better-than-plan reply or close rates or larger deals.
- **Levers:** three packages added to offers.py (Plant Visibility Pilot from $18k, Hardware Rescue
  from $20k, Ops Software Build from $22k); 3-touch follow-up sequence; prospects only in high-budget
  markets (US, CA, UK, IE, EU/EEA, CH, Gulf, AU, NZ, SG, JP, KR, IL); no prices in cold email (quote
  after the call); founder clears the Deck daily and replies to interested leads within hours.
- **Gates:** 2026-10-31: 3 conversations; 2026-11-15: 8 conversations, 4 proposals; 2026-11-30:
  $40k signed; 2026-12-31: $100k signed. Miss at 11-30 -> keep sending, re-target to Q1 2027 closes.

## 10. Q4 2026 sprint: $350k signed by 31 December (founder decision 2026-10-10)

**Target:** $350k signed contract value by 2026-12-31, with deposits collected on signature
(40/40/20 terms => ~$140k cash by year end). Supersedes the day-90 $3-4k/mo target as the
operating goal; the day-90 checkpoint and kill criteria are replaced by the gates below.

**Why the old engine alone cannot do it (the maths, 2026-10-10):** 83 days left. The outbound
engine can send ~750 first-touch emails by year end (domain warm-up + contacts with usable
addresses); at 0.6-1.5% interested replies that is 4-11 conversations and 1-2 closes at ~$5k.
Solo delivery capacity is ~356 hours, which would need ~$980/hour to deliver $350k personally.
So the target requires **large contracts sold founder-led to people who already trust us, and
subcontracted delivery.** Cold outbound becomes the third track, not the first.

**Revenue mix (signed value):**
| Track | Target | Shape | Owner |
|---|---|---|---|
| A. Expansion / whale deals | ~$210k | 3 deals x ~$70k: multi-site rollouts and platform builds for existing clients and network (first: Total Parco eFuelPro network rollout as pilot-then-fleet; then Master Paints, YS Group, Areeb Areel / Al Maymanah multi-site) | Founder, in person |
| B. Dream-25 account-based | ~$90k | 2 deals x ~$45k, PK industrial first (Gulf cycles too long for this window) | Founder + prospector dossiers |
| C. Outbound + referrals + inbound | ~$50k | 6-8 deals x $6-8k (decode sprints, firmware rescue, software builds), worldwide | Epsilon OS + founder approvals |

**Deal construction:** quote rollouts as per-site hardware + install + prepaid annual licence;
offer multi-year prepaid licences and phased SOWs signed as one contract, so signed value and
deposits land now while delivery runs into Q1-Q2 2027. Quotes still come only from offers.py
bands; the founder adds new rollout bands to offers.py first.

**Capacity:** a bench of 2-3 vetted subcontract engineers (firmware/embedded, full-stack) paid
50-60% of billed delivery; founder sells and architects. Nothing is signed whose delivery the
bench cannot cover. Replaces the Act-2 hiring trigger for this window.

**This week (blocking):** Wise/Payoneer + PSEB started and a services contract (MSA + SOW
template, 40/40/20, IP on final payment); meetings requested with decision-makers at Total
Parco, Master Paints, YS Group, Areeb Areel; warm-contacts list to Epsilon OS for referral
asks; one-page rollout proposals for eFuelPro (fuel) and plant monitoring (industrial).

**Gates (cumulative):**
| Date | Proposals out | Signed |
|---|---|---|
| 2026-10-24 | 4 (track A meetings held) | - |
| 2026-11-07 | 10 | $70k |
| 2026-11-21 | 18 | $170k |
| 2026-12-05 | 24 | $260k |
| 2026-12-31 | - | $350k |
Miss protocol: if 2026-11-21 shows < $100k signed and < 12 proposals, switch the year-end goal
to a $350k 2027 run-rate (recurring licences + retainers) instead of forcing discounts.

**Founder hours (weekly):** selling + proposals ~25h, architecture/oversight of the bench ~10h,
Epsilon OS approvals ~5h. Epsilon OS: prospector feeds Dream-25 dossiers and track C; the CEO
brief tracks signed $ vs this table.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code; checkbox as you ship.

- [ ] **T1 (P1, human: ~half day / CC-assisted: ~1h + signups)** — foundations — Register epsilon-labs.co, Google Workspace er@, deploy to Vercel, create private GitHub remote, commit everything
  - Surfaced by: System audit + D6 + finding 1A (domain unregistered; repo no remote)
  - Files: whole repo; `tools/scaffold.py` (SITE already correct)
  - Verify: site live at https://epsilon-labs.co; `git remote -v`; test mail to er@
- [ ] **T2 (P1, human: ~2–5 days elapsed / founder-led)** — payments — Payoneer/Wise Business + PSEB registration + services-contract template
  - Surfaced by: Outside voice #4 [OV-4b]
  - Verify: test USD transfer path confirmed; template reviewed
- [ ] **T3 (P2, human: ~3 days / CC: ~half day)** — site — /capabilities/ wedge-first page + /work/ proof-reframe
  - Surfaced by: 3.2 + OV-2; Files: `tools/content/`, run scaffold + agent + sitemap
  - Verify: `python3 tools/consistency.py` passes; deployed; llms.txt blind test re-run
- [ ] **T4 (P2, founder assets)** — site — Launch blockers: Epsilon1 photos, client logos, Total Parco/YS facts
  - Surfaced by: README "Before launch" · Verify: pages updated, no placeholder claims
- [ ] **T5 (P2, human: ~1 wk / CC: ~1 day)** — Epsilon OS — CRM-lite (SQLite, WAL) + prospector agent + heartbeats + action log + nightly backup
  - Surfaced by: E1 + 1A + 2A · Verify: heartbeat rows; restore-from-backup drill
- [ ] **T6 (P2, human: ~1 wk / CC: ~1–2 days)** — Epsilon OS — Inbound concierge: pre-approved ack template, Auto-Submitted/bounce header checks, injection hard rules, 20-email golden set, autonomy ladder config (no gate deadline)
  - Surfaced by: 3A + 5A + 6A + OV-1 · Verify: golden-set run report (100% opt-out/injection, ≥90% routing)
- [ ] **T7 (P2, human: ~2 days / CC drafts)** — referrals — One-pager (fee to firms/independents only), 10–15 personal asks, lab-notes template
  - Surfaced by: E4 + OV-6b · Verify: asks logged in CRM with channel tags
- [ ] **T8 (P2, human: ~2 days + 3h/wk / CC dossiers)** — Dream-25 — Account list (PK industrial weighted; Gulf tagged long-cycle) + first 8 dossiers
  - Surfaced by: E5 + OV-3 · Verify: dossiers in CRM; first artifacts sent
- [ ] **T9 (P2, human: ~half day + 3–4 wk elapsed)** — outbound — Outreach domain + sending tool + SPF/DKIM/DMARC + warm-up start (PK industrial targeting)
  - Surfaced by: D7 + OV-3 · Verify: warm-up running; DMARC passes
- [ ] **T10 (P3, ~3h/story)** — content — First 2 war stories + public GitHub decode-artifacts repo; post to ≥3 named venues
  - Surfaced by: E3 + OV-3/OV-6a · Verify: live links logged
- [ ] **T11 (P3, CC: ~1 day)** — Epsilon OS — Daily CEO brief: health block, approvals queue, channel-tagged funnel indicators, hours-budget flag
  - Surfaced by: 2A + E1 + OV-4d · Verify: brief arrives by 9am; absence-alarm understood
- [ ] **T12 (P3, human: ~2 days)** — E2 — Pilot one-pager + LOI pitch materials incl. Ex/ATEX zoning answers, privacy annex outline, pilot terms ($2–5k, 60–90 days, success criteria)
  - Surfaced by: E2 + OV-5a · Verify: pitched to anchor candidates by month 2

## 9. Risks

- **Founder bottleneck:** three-wedge discipline + Dream-25 as shock
  absorber; weekly ledger in the CEO brief.
- **Deliverability/compliance blow-up:** separate domain, tool-managed
  warm-up, caps, suppression-forever, human gate.
- **Agent embarrassment / prompt injection:** hard rules + golden-set eval
  gate + approval ladder; agents claim only what offers.py states.
- **Silent agent death:** heartbeats + health block; missing brief = alarm.
- **Data loss:** private remote + nightly CRM backups (verified restores).
- **E2 drags on delivery:** LOI gate, 4h/wk cap, month-9 auto-defer,
  one-time install exception only.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAN | 5 proposals, 5 accepted, 3 deferred; 7 section findings (1A–7A) all resolved; spec loop 3 iterations 4→8.5/10, 30 issues fixed |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**CROSS-MODEL:** Outside voice (Claude subagent, fresh context — Codex not installed) raised 17 points: 3 tensions resolved by founder decision (OV-1 agents kept, gate deadline dropped; OV-2 wedge-first /capabilities/; OV-3 segmented funnel) and 12 additive gaps absorbed (OV-4/5/6); 2 points (#8 partial, #14 partial) resolved as modified-accepts.

**VERDICT:** CEO REVIEW CLEARED — scope, funnel, gates and risks all founder-ratified; eng review required before implementation of Epsilon OS (recommended next: `/plan-eng-review`).

NO UNRESOLVED DECISIONS
