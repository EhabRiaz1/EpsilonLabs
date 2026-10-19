# Upwork kit — paste-ready (2026-10-18)

Personal freelancer profile on Ehab's existing account. Only list work Ehab personally did.
Numbers below marked (est.) are estimates, not Upwork data.

## 0. Before anything (10 min, Ehab)

1. Log in to the existing account (password reset if needed). Do NOT create a second account; Upwork bans duplicates.
2. Settings → Contact info: change email to er@epsilon-labs.co.
3. Check the old profile's history: any job with a bad review or low Job Success Score? Tell Claude; it changes the plan slightly.
4. Identity verification (ID + possibly a video call) and phone: only you can do these. Do them first; unverified profiles rank low.
5. Get paid: Settings → Get Paid → add Payoneer or local bank.

## 1. Profile

**Title (one line):**
Embedded Firmware & Protocol Reverse Engineer | Hardware to Cloud IoT

**Hourly rate:** $40/hr to start. Raise to $55–65 after 5 five-star reviews. Do not go under $30; cheap reads as junk in this category.

**Overview (first two lines are what clients see in search; they carry the profile):**

> I make undocumented hardware talk. I decoded a fuel dispenser's proprietary RS-485 protocol with no documentation (25-byte BCD frames at 38400 baud) and built the receipts, ledger and cloud dashboard on top of it.
>
> What I do, end to end:
> - Embedded firmware: STM32, ESP32, RTOS, drivers, bootloaders, OTA updates, bring-up of new boards
> - Protocol reverse engineering: RS-485/RS-232, Modbus, CAN, proprietary serial; logic-analyser capture to working driver and written spec
> - PCB review and bring-up: schematic review before fab, first-power debugging, BOM risk checks
> - Industrial monitoring: PLC/Modbus data into dashboards and alerts (WhatsApp, email)
> - IoT software: device to cloud (Supabase/Postgres) to web and mobile apps
>
> How I work: I write down what "done" means before I start, I send progress you can check (captures, logs, commits), and I hand over code and docs you own.
>
> Electronics & Electrical Engineering degree. Based in Lahore, overlap with UK/EU mornings and US evenings.
>
> Send me the device, the datasheet you have (or don't), and what it needs to do.

**Skills (add in this order; top ones weigh most):**
Embedded C, Firmware Programming, STM32, ESP32, Reverse Engineering, RS-485, Modbus, Embedded Linux, PCB Design, IoT, Microcontroller Programming, Logic Analyzer, Python, React, Supabase, PLC Programming, SCADA, Arduino

**Specialized profiles:** Upwork reportedly removed these in May 2026, so the single profile and the portfolio carry everything.

## 2. Portfolio

Twelve paste-ready items with slide images, captions and PDFs: `~/dev/upwork-portfolio/PORTFOLIO.md`. Upload in the listed order; eFuelPro is split into five items (system, protocol decode, PCB, firmware, digital twin) so each skill shows up in search.

## 3. Which jobs to bid (filter hard; Connects are cheap, your time is not)

Search terms, saved as alerts: `firmware`, `STM32`, `ESP32`, `reverse engineer protocol`, `RS485`, `Modbus`, `embedded linux`, `PCB bring-up`, `IoT dashboard`, `PLC data`.

Bid when: payment verified · client has hired before (or posted < 24h ago with a clear brief) · budget ≥ $300 fixed or ≥ $25/hr · fewer than 20 proposals · you can describe the first step concretely.
Skip: "simple" + tiny budget, unpaid test tasks, requests to move off Upwork before a contract (against ToS).

Be early: proposals in the first 1–2 hours of a post win far more often.

## 4. Proposal template (≤ 120 words; rewrite the first line every time)

> [One line that proves you read their post: name their device/chip/problem and the likely cause or first step.]
>
> I've done this before: [closest match: decoded an undocumented RS-485 dispenser protocol / brought up an STM32 board / built the device-to-dashboard stack].
>
> How I'd start: [2–3 concrete steps, e.g. capture the bus with a logic analyser, identify framing, write a driver with a test harness].
>
> First milestone: [small, fixed, checkable, e.g. "decoded frame spec + capture log in 3 days, $X"].
>
> One question: [the one thing you need to know].
>
> Ehab

Ask Claude to draft each proposal from the job link; you approve and paste.

## 5. Money: Connects and what to expect

Prices (third-party summaries, Oct 2026; confirm in your account): Connects ~$0.15 each; most jobs cost 2–6 Connects, large ones up to ~16; Freelancer Plus ~$20/month with monthly Connects included; Upwork fee up to 15% of earnings.

**Initial spend: ~$50**
- Freelancer Plus: ~$20 (more visibility, Connects included)
- 200 extra Connects: $30

**Ongoing:** 6–8 targeted proposals/day × ~4 Connects ≈ 800–1,000 Connects/month ≈ **$120–150/month**. Cap month one at $150 total.

**What it could make (est.)**: early-profile win rates are low and vary; these assume 3–5% of good proposals win:

| | Proposals | Wins (est.) | Typical job (est.) | Gross (est.) |
|---|---|---|---|---|
| Month 1 | ~180 | 5–9 | $200–800 | **$1.5–4k** |
| Month 2 | ~180 | 7–12 | $500–2,000 | **$4–10k** |
| Month 3+ | ~150 | 8–12 | $1–4k, some repeat clients | **$8–15k** |

Minus up to 15% fee. Month 1 buys reviews; the $3–4k jobs show up once there are 3–5 five-star reviews. Wide ranges because the real numbers depend on how fast you reply and deliver.

**Kill/keep check at day 30:** fewer than 2 wins from 150+ proposals → profile or targeting is wrong; rewrite before spending more.

## 6. Daily routine (~60–90 min)

1. Morning (PKT afternoon = US morning): open alerts, pick 6–8 jobs that pass section 3.
2. Paste each link to Claude → draft → edit → send.
3. Reply to every client message within 1 hour during your work day.
4. After each job: ask for the review and a 5-star rating in your final message, and offer the next piece of work.
