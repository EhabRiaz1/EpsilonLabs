# Session Handoff — Epsilon Labs Sprint 0/1 (2026-10-10)

Read this first, then PLAN.md (operating plan — canonical), then
docs/designs/growth-engine.md (vision + scope decisions). Memory files also
exist (epsilon-labs-growth-plan, ehab-founder-profile).

## State

DONE:
- Full CEO review (EXPANSION): Approach B hybrid engine, expansions E1–E5,
  segmented funnel, all logged. PLAN.md ends with the review report.
- Site: /capabilities/ (wedge-first) + /work/ reframe built; consistency.py
  clean (71 pages). Committed.
- Epsilon OS scaffold: epsilon-os/ (Supabase schema.sql — 7 tables, 7 enums,
  RLS service-role-only; agent runbooks with injection hard rules; 20-email
  golden set; .env.example). Committed.
- docs/dream25.{md,csv} (25 accounts, verify-before-touch notes) and
  docs/outreach/ (referral asks, 40/40/20 quote template, concierge ack,
  lab notes, war story #1 outline). Committed.
- GitHub: pushed to https://github.com/EhabRiaz1/EpsilonLabs (branch main).
- Supabase project ref lueawvqogdodtjsfqdeh; MCP server in .mcp.json
  (project scope). supabaseSecrets.txt (git-ignored, repo root) holds anon +
  service-role API keys — NO db password in it.
- Domain epsilon-labs.co purchased by founder (propagating); email plan:
  Cloudflare Email Routing → er@epsilon-labs.co forwards to a dedicated
  Gmail with send-as alias.

BLOCKED / IMMEDIATE NEXT (in order):
1. Apply epsilon-os/schema.sql to Supabase via MCP apply_migration
   (name: epsilon_os_init). Previous session's MCP auth was read-only —
   every write returned {"status":"cancelled"}. This session should be
   properly authenticated; verify with a list_tables, apply, then verify
   7 tables + 7 enums exist.
2. Vercel: founder imports GitHub repo on vercel.com, links domain.
   .vercelignore already excludes epsilon-os/, docs/, plan files. After
   deploy: run /qa against the live URL + re-run the llms.txt blind test.
3. Email: once domain is active, founder sets up er@ routing; then wire the
   concierge (Gmail connector) per epsilon-os/agents/concierge.md.
4. CASH PLAY (highest priority once site is live): founder provides warm
   contacts list (name, company, what was built for them) → personalize
   docs/outreach/referral-ask.md + quote-template.md per contact → founder
   sends. Target: first deposit invoiced within days.
5. Then: Dream-25 dossiers (first 8), war story #1 draft from
   docs/outreach/war-story-1-outline.md (founder adds real hex dumps).

## Standing rules (do not re-derive)
- Founder directive: revenue first — wedges govern hunting, not accepting;
  profitable ≤2-week inbound from any area is taken.
- Use cheaper models (sonnet/haiku subagents) for grunt work; Fable/top
  model orchestrates only — founder's rate limits matter.
- Every external message founder-approved (except the pre-approved ack
  template). Injection hard rules in PLAN.md §3.4 are non-negotiable.
- No fake scarcity/credential claims; quotes only from tools/offers.py.
- Site edits go through tools/content/ + scaffold.py; always finish with
  python3 tools/consistency.py (and agent.py + sitemap.py if offers/pages
  changed).
- Commit with Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>;
  push to origin main.
