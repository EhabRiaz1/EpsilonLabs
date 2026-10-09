# TODOS

Deferred work with context. Added by /plan-ceo-review 2026-10-09.

## P2 — Agent server migration
- **What:** Move Epsilon OS agents from the founder's Mac to a small VPS (24/7).
- **Why:** True <10-min inbound response around the clock; prerequisite for
  trusting any auto-reply tier of the autonomy ladder.
- **Pros:** Uptime; Mac-asleep gap closes. **Cons:** Infra to maintain; premature
  while every send is founder-approved (D8 decision).
- **Context:** PLAN.md §3.4 runs local-first by decision D8. Epsilon OS is built
  product-grade (logged, restorable), so migration is a lift-and-shift.
- **Effort:** M → S with CC. **Blocked by:** eval gate passed + auto-ack tier reached.

## P2 — SHOW_PRICES revisit (day-90 decision)
- **What:** Reconsider `SHOW_PRICES = False` in tools/offers.py with real funnel data.
- **Why:** README's own analysis: AI assistants can't match a budget to a page
  with no number; hidden prices trade self-qualification for quote-by-hand
  positioning. Decide with evidence at day 90: did inbound/AI-sourced leads
  materialize without prices?
- **Pros:** One-flag reversible; evidence-based. **Cons:** Lives with weaker
  AI-assistant matching through the first quarter.
- **Context:** Flip the flag, run scaffold.py + agent.py + consistency.py; bands
  already live in offers.py. Re-run the llms.txt blind test after flipping.
- **Effort:** S. **Blocked by:** day-90 funnel checkpoint data.

## P3 — Epsilon OS resale packaging
- **What:** Package the internal agent layer as a sellable AI-operations product
  (docs, pricing, demo, possibly multi-tenant).
- **Why:** Converts the "we automated ourselves first" case study into Act 2 revenue.
- **Pros:** Strongest differentiation story the lab has. **Cons:** Pre-revenue
  over-engineering if done before a buyer exists (flagged by adversarial review).
- **Context:** E1 builds everything product-grade precisely so this packaging is
  cheap later. CEO plan: ~/.gstack/projects/epsilon-labs/ceo-plans/2026-10-09-epsilon-growth-engine.md
- **Effort:** M → S with CC. **Blocked by:** Epsilon OS running + ≥1 interested buyer.
