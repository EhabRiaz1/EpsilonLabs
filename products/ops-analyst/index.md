# Ops Analyst

> Ask your database a question. Approve what it wants to change.

An AI analyst over your own operational data that answers in plain language — and can propose changes, but never make one without a human clicking approve. Scoped by the same permissions as the rest of your app.

- **Price:** quoted per project after a call — er@epsilon-labs.co
- **What moves the price above that floor:** How many data sources it reads, how many actions it may propose, and how fine-grained your permissions are. Read-only is at the floor; write actions across several systems are where the time goes.
- **Typical duration:** 4–6 weeks
- **Category:** Software
- **Page:** https://epsilon-labs.co/products/ops-analyst/
- **Enquiries:** er@epsilon-labs.co

## The problem

Your operational data answers most of the questions your managers ask — but only if someone writes the query. So the questions wait for an analyst, or they do not get asked.

The obvious fix, an AI assistant with database access, is the dangerous one done carelessly: a model that can read every row and change any of them on its own judgement is not a feature. It is an incident waiting for a date.

## What you get

- A conversational analyst over your own database, answering in plain language
- Every answer grounded in a real query you can inspect
- Proposed changes that require explicit human approval — never model discretion
- Scoped by row-level security, so it sees only what the asking user may see
- A full audit log of every question, query, proposal and approval
- Streamed responses and prompt caching to keep it fast and cheap

## How it runs

- **Weeks 1–2** — Your data and your permissions mapped. What it may read, what it may propose.
- **Weeks 3–4** — Tool catalogue and approval flow built and red-teamed against your policies.
- **Weeks 5–6** — Pilot with one team, then rollout.

## This is for you if

- Operations teams whose questions queue behind one analyst
- Businesses that want AI over their data and refuse to hand it the keys
- Postgres and Supabase applications with row-level security already in place

## This is NOT for you if

- Autonomous agents that act without approval — we will not build that
- Customer-facing chatbots
- Data you cannot legally process with a third-party model

## Proof

Finance AI is an agentic analyst console over a portfolio database: a server-side tool-calling loop across a 22-tool catalogue with streamed responses, prompt caching, and write operations gated behind explicit user approval rather than model discretion.

See: https://epsilon-labs.co/work/finance-ai/

## Questions

### Which model does it use?

Claude by default, through your own account, so the usage is billed to you and your data stays under your agreement with the provider.

### Can it change data on its own?

No. It proposes; a person approves. That is the design, not a setting.
