"""Prospector (P1, P4, P5): finds companies with a visible, current, unmet need and prepares the first touch.

Research is the only web-facing call (core.llm.research: WebSearch + WebFetch, nothing else). Everything it
returns is validated here before it is trusted, dossiers and drafts are written by tool-less core.llm.ask
calls, and nothing is ever sent: the draft lands in approval_queue (kind 'outbound') for the founder.

Order of work per prospect: dedupe and suppression first (cheap), then the two LLM writes, then the DB
writes. A budget stop or a failed dossier therefore never leaves a half-made company behind.

    python -m agents.prospector --dry-run --strategy s2_trigger --n 3

Strategies S2-S13 (prompts/strategies.py) replace the old three-segment search. Settings prospector.mix splits the
daily total between the software strategies (S11-S13) and the hardware ones (S2-S10); inside each group the quotas
(Settings strategy.quotas) weigh the strategies. S6, the learning loop, moves quota toward the strategy with the best
positive-reply rate inside the same group (the mix governs the split between groups), weekly and within bounds, and
never touches a pinned strategy. S13 reads the Hacker News freelancer thread in code (core/feeds/hn_freelancer.py);
a tool-less model only scores those posts.
"""
import argparse
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from agents.inbox import first_name
from core import config, ledger, lint, llm as llm_mod, settings as settings_mod
from core.db import DB
from core.feeds import hn_freelancer
from prompts import loader, schemas, strategies as strat

AGENT = "prospector"
BATCH = 5
CALLS_PER_STRATEGY = 3
STALE_POST_DAYS = 45        # S5 last resort: a full-time post must be older than this ...
SMALL_COMPANY = 50          # ... and the company smaller than this
RECENCY_DAYS = {"funding": 120, "expansion": 120, "grant": 365}   # per trigger type; others use Strategy.max_age_days
MIN_SENDS = 40              # S6: sends in 30 days a strategy needs before it takes part in a rebalance
REBALANCE_STEP = 2          # S6: at most this many quota units move per week
REBALANCE_FLOOR = 2         # S6: a donor never goes below this
POSITIVE_LABELS = ("inquiry", "interested")
APPROVED = ("approved", "edited_approved", "sending", "sent")
LEGACY = "legacy"
JOB_URL = re.compile(r"greenhouse\.io|lever\.co|workable\.com|ashbyhq\.com|recruitee\.com|bamboohr\.com|indeed\.|linkedin\.com/jobs"
                     r"|/careers?(?:/|$|\?)|/jobs?(?:/|$|\?)|/vacanc|/positions?/|/openings?", re.I)
JOB_TEXT = re.compile(r"\b(full[- ]time|permanent (?:position|role)|we(?:'re| are) hiring|job (?:opening|description)|apply now|"
                      r"join our team|vacanc(?:y|ies)|years of experience|salary)\b", re.I)
OUTSOURCE = re.compile(r"\b(rfq|rfp|request for (?:proposals?|quotations?|quotes?|information)|statement of work|sow|outsourc\w*|"
                       r"development partner|(?:looking|searching) for (?:an? |the )?(?:\w+ ){0,3}(?:firm|agency|contractor|consultan\w+|vendor|partner|supplier)|"
                       r"seeking (?:an? )?(?:\w+ ){0,3}(?:firm|agency|contractor|consultan\w+|vendor|partner))\b", re.I)
# S4 drafts are a peer proposal; code holds one that slides into customer-sales language.
SALES_WORDS = re.compile(r"\b(our services|our solutions?|affordable|best[- ]in[- ]class|special offer|limited time|save you|"
                         r"boost your|cost[- ]effective|book a demo|world[- ]class|end[- ]to[- ]end solutions?)\b", re.I)
MIN_CONFIDENCE = 0.4
MAX_WORDS = 135
KNOWN_IN_PROMPT = 300
OPT_OUT_LINE = "Reply 'stop' and I won't write again."
WEDGE = {"industrial": "industrial_monitoring", "oem_hardware": "protocol_decode", "smb_software": "other"}
EU = {"AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
      "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"}
EEA = {"IS", "LI", "NO"}
FREEMAIL = {"gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "icloud.com",
            "proton.me", "protonmail.com", "aol.com", "gmx.com", "yandex.com", "msn.com"}
NOT_A_COMPANY = {"linkedin.com", "indeed.com", "glassdoor.com", "reddit.com", "facebook.com", "twitter.com", "x.com",
                 "kickstarter.com", "indiegogo.com", "crowdsupply.com", "github.com", "stackoverflow.com", "stackexchange.com", "youtube.com", "medium.com", "upwork.com",
                 "fiverr.com", "freelancer.com", "wikipedia.org", "google.com", "naukri.com", "rozee.pk"}
CONTACT_BATCH = 8
HN_STRATEGY = "s13_hn"
HN_BATCH = 15               # posts per tool-less scoring call
HIRING_INBOXES = {"careers", "career", "jobs", "job", "hr", "recruiting", "recruitment", "recruiter", "talent", "hiring",
                  "apply", "applications", "people"}
# Inboxes that exist for something other than a business conversation; writing a pitch there looks careless.
NON_SALES_INBOXES = {"legal", "security", "privacy", "abuse", "dpo", "gdpr", "compliance", "noreply", "no-reply",
                     "donotreply", "postmaster", "webmaster", "press", "media", "pr", "billing", "invoices",
                     "accounts", "accounting", "finance", "unsubscribe", "vulnerability", "psirt", "disclosure"}
# Shared inboxes. With Settings prospector.named_only on, a prospect needs a named person's address instead.
GENERIC_INBOXES = {"info", "hello", "hi", "contact", "contactus", "enquiries", "enquiry", "inquiries", "inquiry", "sales",
                   "support", "office", "team", "mail", "admin", "general", "kontakt", "post", "service", "help"}
# Pages an address may not be taken from: GitHub's Acceptable Use Policy forbids using its data for unsolicited email.
BANNED_CONTACT_SOURCES = ("github.com", "githubusercontent.com", "gitlab.com")
# Contact-finding instruction for the research prompts, chosen by Settings prospector.named_only.
CONTACT_RULE_DEFAULT = ("Prefer, in order: a named founder or engineering lead address shown on the site; then hello@, info@, contact@, team@, sales@, "
                        "engineering@ or partnerships@. Never use careers@, jobs@, hr@, recruiting@, talent@ or any hiring inbox, never a personal address "
                        "from a third-party site, data broker, social profile, code repository (GitHub, GitLab) or leaked list, and never guess or construct "
                        "an address from a name pattern.")
CONTACT_RULE_NAMED = ("Find a NAMED person: the CTO, head of engineering, firmware or R&D lead, or a technical founder of a small company, whose own address "
                      "the company publishes on its own website (team, about, imprint or contact page) or in its own press releases. Give their name, role and that "
                      "address. Never return a shared inbox (info@, hello@, contact@, sales@, support@, office@, team@ and similar), never an address seen on "
                      "GitHub, GitLab or any code repository, a data broker, social profile or leaked list, and never guess or construct an address from a name "
                      "pattern. If no named person's address is published, give no address for that company.")
DOMAIN_RE = re.compile(r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$")
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$")


# ---------------------------------------------------------------- pure helpers

# Markets where a client can pay a Pakistan firm and budgets reach $10k+ (founder 2026-10-11). The live list is Settings
# prospector.markets; Pakistan and sanctioned markets (settings.ALWAYS_EXCLUDED) are rejected whatever the setting says.
TARGET_MARKETS = frozenset(settings_mod.DEFAULT_MARKETS)  # default list; the live list is Settings prospector.markets



def region_for(country: str) -> tuple[str, str]:
    """(region, legal_basis). UK/EU/EEA get legitimate_interest_b2b, everywhere else business_contact."""
    c = (country or "").upper()
    if c == "GB":
        return "UK", "legitimate_interest_b2b"
    if c in EU:
        return "EU", "legitimate_interest_b2b"
    if c in EEA:
        return "EEA", "legitimate_interest_b2b"
    return c or "XX", "business_contact"


def clean_domain(raw: str) -> str | None:
    d = (raw or "").strip().lower()
    if "//" in d:
        d = urlparse(d).netloc or ""
    d = d.split("/")[0].split(":")[0].removeprefix("www.").strip(".")
    if not DOMAIN_RE.match(d) or d in FREEMAIL or any(d == b or d.endswith("." + b) for b in NOT_A_COMPANY):
        return None
    return d


def _one_line(s: str, limit: int) -> str:
    return re.sub(r"\s+", " ", s or "").strip()[:limit]


def valid_url(u: str) -> bool:
    p = urlparse(u or "")
    return p.scheme in ("http", "https") and bool(p.netloc) and " " not in u


def check_contact(c, domain: str, named_only: bool = False) -> tuple[dict | None, str]:
    """P5 contact rules: published, on the company's own domain, not a hiring inbox, with a source page.
    named_only (Settings prospector.named_only) also refuses shared inboxes such as info@ and hello@."""
    if not (isinstance(c, dict) and c.get("email")):
        return None, ""
    m = EMAIL_RE.match(str(c["email"]).strip())
    host = m.group(1).lower() if m else ""
    if not m:
        return None, "malformed contact email"
    if not (host == domain or host.endswith("." + domain)):
        return None, "contact email not on the company domain"
    if m.group(0).split("@")[0].lower() in HIRING_INBOXES:
        return None, "hiring inbox, not a buyer contact"
    if m.group(0).split("@")[0].lower() in NON_SALES_INBOXES:
        return None, "legal/security/admin inbox, not a buyer contact"
    if named_only and m.group(0).split("@")[0].lower() in GENERIC_INBOXES:
        return None, "shared inbox, not a named person"
    if not valid_url(str(c.get("source_url") or "")):
        return None, "contact without a source url"
    src_host = urlparse(str(c["source_url"]).strip()).netloc.lower().removeprefix("www.")
    if any(src_host == b or src_host.endswith("." + b) for b in BANNED_CONTACT_SOURCES):
        return None, "address taken from a code host (GitHub terms forbid it for unsolicited email)"
    return {"email": str(c["email"]).strip().lower(), "name": _one_line(c.get("name"), 120),
            "role": _one_line(c.get("role"), 120), "source_url": c["source_url"].strip()}, ""


def contact_rule(S) -> str:
    return CONTACT_RULE_NAMED if getattr(S, "named_only", False) else CONTACT_RULE_DEFAULT


def fill_contacts(S, prospects: list[dict]) -> int:
    """One batched web call that looks for a published business address on each contact-less company's own site."""
    need = [p for p in prospects if not p["contact"] and p["domain"] not in S.known][:CONTACT_BATCH]
    if not need or S.budget_hit:
        return 0
    system = loader.compose("find_contact", {"today": S.today, "domains": "\n".join(p["domain"] for p in need),
                                             "contact_rule": contact_rule(S)},
                            preamble="preamble_research")
    try:
        data, _ = S.llm.research(S.db, AGENT, S.run_id, system, "Find the published contact addresses.",
                                 schemas.CONTACTS, model="sonnet")
    except llm_mod.BudgetExceeded:
        S.budget_hit = True
        return 0
    except llm_mod.LLMError as e:
        _log(S, "contact_search_failed", detail={"error": str(e)[:200]})
        return 0
    by_domain = {p["domain"]: p for p in need}
    found = 0
    for c in data.get("contacts") or []:
        p = by_domain.get(clean_domain(str(c.get("domain") or "")) or "")
        if not p or p["contact"]:
            continue
        contact, note = check_contact(c, p["domain"], getattr(S, "named_only", False))
        if contact:
            p["contact"], p["contact_note"] = contact, "contact found on the company site"
            found += 1
        else:
            p["contact_note"] = note
    S.c["contacts_found"] = S.c.get("contacts_found", 0) + found
    _log(S, "contact_search_done", detail={"asked": len(need), "found": found, "notes": (data.get("notes") or "")[:200]})
    return found


def _day(v) -> date | None:
    try:
        return date.fromisoformat(str(v).strip()[:10]) if str(v or "").strip() else None
    except ValueError:
        return None


def _int(v) -> int:
    return v if isinstance(v, int) and not isinstance(v, bool) else 0


def is_fulltime_post(raw: dict, quote: str, obs: str) -> bool:
    """S5: the model said so, or the page looks like a job post and shows no explicit outsourcing language."""
    if raw.get("trigger_type") == "fulltime_post":
        return True
    text = f"{quote} {obs} {raw.get('trigger') or ''}"
    jobish = bool(JOB_URL.search(str(raw.get("evidence_url") or "")) or JOB_TEXT.search(text))
    return jobish and not OUTSOURCE.search(text)


def validate(raw: dict, strategy: str, slugs: set[str], today: date | None = None,
             segments: list[str] | None = None, markets=None, named_only: bool = False) -> tuple[dict | None, str]:
    """Code-side check of one research result. Returns (prospect, "") or (None, reason)."""
    if not isinstance(raw, dict):
        return None, "not an object"
    st = strat.get(strategy)
    today = today or datetime.now(timezone.utc).date()
    if not valid_url(str(raw.get("evidence_url") or "")):
        return None, "no evidence_url"
    domain = clean_domain(str(raw.get("domain") or ""))
    if not domain:
        return None, "bad domain"
    if raw.get("strategy") != strategy:
        return None, "wrong strategy"
    if raw.get("suggested_offer_slug") not in slugs:
        return None, "unknown offer slug"
    if st.strict_offers and raw["suggested_offer_slug"] not in st.offers:
        return None, "offer outside the strategy's offer set"
    conf = raw.get("confidence")
    if not isinstance(conf, (int, float)) or conf < MIN_CONFIDENCE:
        return None, "low confidence"
    quote, obs = _one_line(raw.get("evidence_quote"), 240), _one_line(raw.get("observation"), 400)
    country = str(raw.get("country") or "").upper()
    name = _one_line(raw.get("name"), 160)
    if not (quote and obs and name and re.fullmatch(r"[A-Z]{2}", country)):
        return None, "missing field"
    if country in settings_mod.ALWAYS_EXCLUDED or country not in (TARGET_MARKETS if markets is None else markets):
        return None, "outside target markets"
    ttype = raw.get("trigger_type") if raw.get("trigger_type") in strat.TRIGGER_TYPES else "other"
    headcount, post_age = _int(raw.get("headcount")), _int(raw.get("post_age_days"))
    if st.max_headcount is not None and headcount > st.max_headcount:
        return None, f"{headcount} staff (limit {st.max_headcount})"
    last_resort = False
    if strategy == "s5_intent" and is_fulltime_post(raw, quote, obs):
        if not (0 < headcount < SMALL_COMPANY and post_age > STALE_POST_DAYS):
            return None, "full-time post: only a small company with a stale post qualifies"
        ttype, last_resort = "fulltime_post", True
    elif ttype not in st.trigger_types:
        return None, f"trigger type {ttype} is not a {st.name} trigger"
    ev_date = _day(raw.get("evidence_date"))
    if str(raw.get("evidence_date") or "").strip() and ev_date is None:
        return None, "unreadable evidence_date"
    if not last_resort:
        if ev_date is None and ttype in st.dated_types:
            return None, "trigger without a date"
        if ev_date is not None:
            age = (today - ev_date).days
            limit = RECENCY_DAYS.get(ttype, st.max_age_days)
            if age < -st.max_future_days:
                return None, "evidence dated in the future"
            if limit is not None and age > limit:
                return None, f"evidence is {age} days old (limit {limit})"
    seg = raw.get("segment") if raw.get("segment") in schemas.PROSPECT_SEGMENTS else st.segment
    if segments is not None and seg not in segments:
        return None, "segment disabled in settings"
    contact, contact_note = check_contact(raw.get("contact"), domain, named_only)
    return {"name": name, "domain": domain, "country": country, "sector": _one_line(raw.get("sector"), 80),
            "strategy": strategy, "segment": seg, "evidence_url": raw["evidence_url"].strip(), "evidence_quote": quote,
            "evidence_date": ev_date.isoformat() if ev_date else "", "trigger": _one_line(raw.get("trigger"), 200),
            "trigger_type": ttype, "last_resort": last_resort, "headcount": headcount, "post_age_days": post_age,
            "observation": obs, "offer_slug": raw["suggested_offer_slug"], "contact": contact,
            "contact_note": contact_note, "confidence": float(conf)}, ""


def strategy_order(enabled: list[str], today: date) -> list[str]:
    """Round-robin: today's lead strategy advances by one each day, so a budget stop never starves the same one."""
    if not enabled:
        return []
    i = today.toordinal() % len(enabled)
    return enabled[i:] + enabled[:i]


def finish_draft(body: str) -> tuple[str, list[str]]:
    """Force the exact opt-out ending (P5) and report soft problems that should hold the draft."""
    text = body.replace("’", "'").strip()
    problems = []
    if not text.endswith(OPT_OUT_LINE):
        text = text.rstrip() + "\n\n" + OPT_OUT_LINE
        problems.append("opt-out line was added by code")
    words = len(text.split())
    if words > MAX_WORDS:
        problems.append(f"{words} words (limit {MAX_WORDS})")
    return text, problems


# ---------------------------------------------------------------- S6: quotas, stats, rebalance

def apportion(budget: int, weights: dict) -> dict:
    """Split `budget` whole units across `weights` in proportion (largest remainder; ties go to the earlier key).
    Every key keeps a share of 0 when the weights are all 0."""
    total = sum(weights.values())
    if budget <= 0 or total <= 0:
        return dict.fromkeys(weights, 0)
    exact = {k: budget * w / total for k, w in weights.items()}
    out = {k: int(v) for k, v in exact.items()}
    order = sorted(weights, key=lambda k: -(exact[k] - out[k]))   # sorted() is stable: ties keep strategy order
    for k in order[: budget - sum(out.values())]:
        out[k] += 1
    return out


def effective_quotas(quotas: dict, per_day: int, mix: int = settings_mod.DEFAULT_MIX) -> dict:
    """Today's per-strategy targets. The total is the quotas' sum, capped at prospector.per_day. `mix` percent of it
    goes to the software strategies and the rest to the hardware ones; inside each group the quotas are weights.
    A group whose quotas are all 0 is switched off and the other group takes the whole total."""
    q = {sid: max(int(quotas.get(sid, 0)), 0) for sid in settings_mod.STRATEGY_IDS}
    total = max(min(sum(q.values()), per_day), 0)
    soft = {s: q[s] for s in settings_mod.SOFTWARE_STRATEGIES}
    hard = {s: q[s] for s in settings_mod.HARDWARE_STRATEGIES}
    if not sum(soft.values()):
        soft_total = 0
    elif not sum(hard.values()):
        soft_total = total
    else:
        soft_total = int(total * min(max(mix, 0), 100) / 100 + 0.5)
    out = apportion(total - soft_total, hard) | apportion(soft_total, soft)
    return {sid: out[sid] for sid in settings_mod.STRATEGY_IDS}


def _ts(v) -> datetime | None:
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def strategy_stats(db, now: datetime, windows: tuple = (30, 90)) -> dict:
    """{strategy: {days: {created, approved, sent, replies, positive, optouts, advanced, won_value,
    reply_rate, positive_rate}}} for each strategy and 'legacy'. Rates are per send (None before the first send).

    created   companies with the strategy created in the window
    approved  outbound drafts decided into approved/edited_approved/sending/sent in the window
    sent      touches type 'sent' (outbound) in the window, follow-ups included
    replies   touches type 'human_reply'; positive = classifier label inquiry or interested
    optouts   touches type 'opt_out' plus replies the classifier labelled opt_out
    advanced  deals past 'lead' whose stage last changed (updated_at) in the window
    won_value sum of value_usd of won deals closed in the window
    Strategy attribution is deals.strategy, reached from queue rows and touches through deal_id."""
    ids = list(settings_mod.STRATEGY_IDS) + [LEGACY]
    flt = f"in.({','.join(ids)})"
    horizon = (now - timedelta(days=max(windows))).isoformat()
    deals = db.select("deals", strategy=flt, limit=5000)
    by_deal = {d["id"]: d["strategy"] for d in deals}
    companies = db.select("companies", strategy=flt, created_at=f"gte.{horizon}", limit=5000)
    queue = db.select("approval_queue", agent=AGENT, kind="outbound", decided_at=f"gte.{horizon}", limit=5000)
    touches = db.select("touches", occurred_at=f"gte.{horizon}", limit=5000)
    out: dict = {}
    for sid in ids:
        out[sid] = {}
        for days in windows:
            since = now - timedelta(days=days)
            m = dict.fromkeys(("created", "approved", "sent", "replies", "positive", "optouts", "advanced"), 0)
            m["won_value"] = 0.0
            m["created"] = sum(1 for c in companies if c["strategy"] == sid and (_ts(c.get("created_at")) or since) >= since)
            m["approved"] = sum(1 for q in queue if by_deal.get(q.get("deal_id")) == sid and q.get("status") in APPROVED
                                and (_ts(q.get("decided_at")) or since) >= since)
            for t in touches:
                if by_deal.get(t.get("deal_id")) != sid or (_ts(t.get("occurred_at")) or since) < since:
                    continue
                label = (t.get("classifier") or {}).get("label")
                if t.get("type") == "sent" and t.get("direction") == "outbound":
                    m["sent"] += 1
                elif t.get("type") == "human_reply":
                    m["replies"] += 1
                    m["positive"] += 1 if label in POSITIVE_LABELS else 0
                    m["optouts"] += 1 if label == "opt_out" else 0
                elif t.get("type") == "opt_out":
                    m["optouts"] += 1
            for d in deals:
                if d["strategy"] != sid:
                    continue
                if d.get("stage") != "lead" and (_ts(d.get("updated_at")) or since) >= since:
                    m["advanced"] += 1
                if d.get("stage") == "won" and (_ts(d.get("closed_at") or d.get("updated_at")) or since) >= since:
                    m["won_value"] += float(d.get("value_usd") or 0)
            m["reply_rate"] = m["replies"] / m["sent"] if m["sent"] else None
            m["positive_rate"] = m["positive"] / m["sent"] if m["sent"] else None
            out[sid][days] = m
    return out


def rebalance(quotas: dict, stats30: dict, pinned, *, min_sends: int = MIN_SENDS, step: int = REBALANCE_STEP,
              floor: int = REBALANCE_FLOOR) -> dict | None:
    """Weekly S6 move, inside one group only: software (S11-S13) or hardware (S2-S10). prospector.mix sets the split
    between the groups, so moving quota across them would only be undone by the mix. Each group is judged on its
    own (see _rebalance_group); when both have a move, the one with the larger rate gap wins. One move a week."""
    best = None
    for group in (settings_mod.HARDWARE_STRATEGIES, settings_mod.SOFTWARE_STRATEGIES):
        mv = _rebalance_group(group, quotas, stats30, pinned, min_sends=min_sends, step=step, floor=floor)
        if mv and (best is None or mv["rates"][mv["to"]] - mv["rates"][mv["from"]]
                   > best["rates"][best["to"]] - best["rates"][best["from"]]):
            best = mv
    return best


def _rebalance_group(group, quotas: dict, stats30: dict, pinned, *, min_sends: int, step: int, floor: int) -> dict | None:
    """Only strategies with at least `min_sends` sends in 30 days, a quota above 0 (0 means switched off)
    and not pinned take part, and at least two must qualify. Up to `step` quota units move from the lowest
    positive-reply-rate strategy that is still above `floor` to the highest-rate one; nothing moves unless the
    recipient's rate is strictly higher. Total quota is conserved. Returns the change or None."""
    rate = {}
    for sid in group:
        m = stats30.get(sid) or {}
        if sid not in pinned and quotas.get(sid, 0) > 0 and m.get("sent", 0) >= min_sends:
            rate[sid] = m["positive"] / m["sent"]
    if len(rate) < 2:
        return None
    donors = [s for s in rate if quotas[s] > floor]
    if not donors:
        return None
    donor = min(donors, key=lambda s: (rate[s], -quotas[s]))
    others = [s for s in rate if s != donor]
    recipient = max(others, key=lambda s: (rate[s], quotas[s] * -1))
    if rate[recipient] <= rate[donor]:
        return None
    moved = min(step, quotas[donor] - floor)
    new = dict(quotas)
    new[donor] -= moved
    new[recipient] += moved
    return {"from": donor, "to": recipient, "moved": moved, "quotas": new, "rates": {k: round(v, 4) for k, v in rate.items()}}


def is_rebalance_day(now: datetime) -> bool:
    return now.astimezone(ZoneInfo(config.TZ)).weekday() == 0


def next_rebalance(now: datetime, checked_today: bool = False) -> date:
    """The Monday the next weekly rebalance runs (today if it is Monday and has not run yet)."""
    d = now.astimezone(ZoneInfo(config.TZ)).date()
    ahead = (7 - d.weekday()) % 7
    return d + timedelta(days=ahead if ahead or not checked_today else 7)


def rebalance_actions(db, now: datetime, limit: int = 1):
    start = now.astimezone(ZoneInfo(config.TZ)).replace(hour=0, minute=0, second=0, microsecond=0)
    return start, db.select("actions", agent=AGENT, action="in.(quota_rebalanced,quota_rebalance_checked)",
                            order="at.desc", limit=limit)


def maybe_rebalance(S, settings, now: datetime) -> str:
    """Mondays only, once per day, live runs only. Writes the new quotas and logs `quota_rebalanced`; a check that
    changes nothing logs `quota_rebalance_checked` (that is also what stops a second run the same Monday)."""
    if S.dry or not is_rebalance_day(now) or not settings.get("strategy.auto_rebalance"):
        return ""
    start, last = rebalance_actions(S.db, now)
    if last and (_ts(last[0].get("at")) or start) >= start:
        return ""
    quotas, pinned = settings.get("strategy.quotas"), settings.get("strategy.pinned")
    stats = strategy_stats(S.db, now, (30,))
    move = rebalance(quotas, {sid: stats[sid][30] for sid in settings_mod.STRATEGY_IDS}, pinned)
    if move is None:
        _log(S, "quota_rebalance_checked", detail={"quotas": quotas})
        return ""
    settings.set("strategy.quotas", move["quotas"])
    _log(S, "quota_rebalanced", detail=move)
    return (f"Quota rebalanced: {move['moved']} from {settings_mod.STRATEGY_LABEL[move['from']]} to "
            f"{settings_mod.STRATEGY_LABEL[move['to']]} (positive-reply rate)")


# ---------------------------------------------------------------- run state

class State:
    def __init__(self, db, llm, run_id: str, dry: bool):
        self.db, self.llm, self.run_id, self.dry = db, llm, run_id, dry
        self.budget_hit = False
        self.known: set[str] = set()
        self.rows: list[dict] = []
        self.notes: list[str] = []
        self.today = ""
        self.today_date: date | None = None
        self.segments: list[str] | None = None
        self.markets: list[str] | None = None
        self.hn_fetch = hn_freelancer.fetch_candidates
        self.by = {sid: dict.fromkeys(("research_calls", "returned", "invalid", "created", "drafts", "no_contact"), 0)
                   for sid in settings_mod.STRATEGY_IDS}
        self.c = dict.fromkeys(("research_calls", "returned", "invalid", "dup", "suppressed", "existing", "created",
                                "no_contact", "drafts", "held", "dossier_failed", "draft_failed", "research_failed",
                                "errors"), 0)


def _log(S, action: str, **kw) -> None:
    try:
        ledger.action(S.db, AGENT, S.run_id, action, **kw)
    except Exception:
        pass  # logging must never kill the run


def _facts(p: dict) -> str:
    return json.dumps({k: p[k] for k in ("name", "domain", "country", "sector", "strategy", "trigger", "trigger_type",
                                         "evidence_date", "evidence_url", "evidence_quote", "observation")}
                      | {"contact_role": (p["contact"] or {}).get("role", "")}, ensure_ascii=False)


def dossier_header(p: dict) -> str:
    """Code-written top of every dossier: which strategy found it and why now (the model writes the rest)."""
    st = strat.get(p["strategy"])
    lines = [f"**Strategy:** {st.name} ({p['strategy']})"]
    if p["trigger"]:
        when = f" ({p['evidence_date']})" if p["evidence_date"] else ""
        lines.append(f"**Trigger:** {p['trigger_type']}: {p['trigger']}{when}")
    if p["last_resort"]:
        lines.append(f"**Last resort:** a full-time post at a company of about {p['headcount']} people, "
                     f"posted {p['post_age_days']} days ago. Not an explicit request for a contractor.")
    return "\n".join(lines) + "\n\n"


def _dossier(S, p: dict) -> str:
    system = loader.compose("dossier", {})
    data, _ = S.llm.ask(S.db, AGENT, S.run_id, system, _facts(p), schemas.DOSSIER, model="haiku")
    return dossier_header(p) + data["body_md"]


def _outbound(S, p: dict) -> dict:
    st = strat.get(p["strategy"])
    first = first_name((p["contact"] or {}).get("name", ""))
    ctx = (f"first name: {first if first != 'there' else '(none, use \"Hi,\")'}; company: {p['name']}; "
           f"country: {p['country']}")
    angle = st.angle + (" The signal is a last-resort full-time post: offer a fixed-scope engagement that delivers while they hire."
                        if p["last_resort"] else "")
    system = loader.compose(st.outbound, {"context": ctx, "focus": loader.offer_line(p["offer_slug"]), "angle": angle})
    data, _ = S.llm.ask(S.db, AGENT, S.run_id, system, _facts(p), schemas.OUTBOUND, model="sonnet")
    return data


def _write(S, p: dict, dossier: str, draft: dict | None) -> dict:
    """Company, contact, deal, dossier and (when there is an address and a draft) the queue row."""
    db = S.db
    region, basis = region_for(p["country"])
    company = db.insert("companies", {
        "name": p["name"], "domain": p["domain"], "country": p["country"], "sector": p["sector"] or None,
        "wedge": WEDGE[p["segment"]], "is_dream25": False, "strategy": p["strategy"],
        "notes": (f"Prospector ({p['strategy']}/{p['segment']}): {p['observation']} Evidence: {p['evidence_url']}"
                  + (" Last resort: full-time post at a small company, stale." if p["last_resort"] else ""))})[0]
    S.known.add(p["domain"])
    contact = None
    if p["contact"]:
        c = p["contact"]
        contact = db.insert("contacts", {
            "company_id": company["id"], "full_name": c["name"] or None, "email": c["email"],
            "role": c["role"] or None, "region": region, "legal_basis": basis})[0]
    deal = db.insert("deals", {
        "company_id": company["id"], "primary_contact_id": contact["id"] if contact else None,
        "title": ("Outbound: " + p["observation"])[:140], "stage": "lead", "wedge": WEDGE[p["segment"]],
        "source_channel": "outbound", "strategy": p["strategy"]})[0]
    sources = [{"url": p["evidence_url"], "kind": "evidence", "quote": p["evidence_quote"]}]
    if p["contact"]:
        sources.append({"url": p["contact"]["source_url"], "kind": "contact_address"})
    db.insert("dossiers", {"company_id": company["id"], "version": 1, "body_md": dossier, "sources": sources,
                           "created_by": AGENT}, returning=False)
    _log(S, "prospect_created", target_table="companies", target_id=company["id"],
         detail={"domain": p["domain"], "strategy": p["strategy"], "segment": p["segment"], "deal_id": deal["id"],
                 "evidence_url": p["evidence_url"], "trigger_type": p["trigger_type"], "last_resort": p["last_resort"]})
    out = {"company_id": company["id"], "deal_id": deal["id"], "queued": None}
    if contact and draft:
        body, problems = finish_draft(draft["body"])
        hits = lint.lint(body, {"recipient": contact["email"]})
        reasons = [x for x in problems if "added by code" not in x]
        if p["strategy"] == "s4_partner" and SALES_WORDS.search(body):
            reasons.append("sales wording in a partner draft")
        if hits:
            reasons.append("lint: " + ", ".join(sorted({h["type"] for h in hits})))
        held = bool(reasons)
        row = db.insert("approval_queue", {
            "agent": AGENT, "kind": "outbound", "deal_id": deal["id"], "contact_id": contact["id"],
            "draft": body, "status": "pending", "to_email": contact["email"],
            "subject": _one_line(draft["subject"], 120), "run_id": S.run_id, "held": held,
            "held_reason": "; ".join(reasons) or None, "lint": hits})[0]
        S.c["drafts"] += 1
        S.by[p["strategy"]]["drafts"] += 1
        S.c["held"] += 1 if held else 0
        out["queued"] = row["id"]
        _log(S, "draft_queued", target_table="approval_queue", target_id=row["id"],
             detail={"kind": "outbound", "held": held, "lint": len(hits), "offer": p["offer_slug"], "strategy": p["strategy"],
                     "notes": (draft.get("notes") or "")[:200]})
    return out


def _process(S, p: dict) -> None:
    db = S.db
    row = {"company": p["name"], "domain": p["domain"], "country": p["country"], "strategy": p["strategy"],
           "segment": p["segment"], "trigger": p["trigger"], "trigger_type": p["trigger_type"],
           "evidence_date": p["evidence_date"], "last_resort": p["last_resort"], "evidence_url": p["evidence_url"], "evidence_quote": p["evidence_quote"], "observation": p["observation"],
           "offer": p["offer_slug"], "contact": p["contact"], "confidence": p["confidence"]}
    if p["domain"] in S.known:
        S.c["dup"] += 1
        _log(S, "prospect_dropped", detail={"domain": p["domain"], "reason": "known domain"})
        return
    if p["contact"]:
        addr = p["contact"]["email"]
        if db.rpc("is_suppressed", {"addr": addr}):
            S.c["suppressed"] += 1
            _log(S, "prospect_dropped", detail={"domain": p["domain"], "reason": "suppressed address"})
            return
        if db.select("contacts", email=addr, limit=1):
            S.c["existing"] += 1
            _log(S, "prospect_dropped", detail={"domain": p["domain"], "reason": "existing contact"})
            return
    try:
        dossier = _dossier(S, p)
    except llm_mod.BudgetExceeded:
        S.budget_hit = True
        return
    except llm_mod.LLMError as e:
        S.c["dossier_failed"] += 1
        _log(S, "dossier_failed", detail={"domain": p["domain"], "error": str(e)[:200]})
        return
    draft = None
    if p["contact"]:
        try:
            draft = _outbound(S, p)
        except llm_mod.BudgetExceeded:
            S.budget_hit = True
            S.c["draft_failed"] += 1
            _log(S, "draft_failed", detail={"domain": p["domain"], "error": "budget"})
        except llm_mod.LLMError as e:
            S.c["draft_failed"] += 1
            _log(S, "draft_failed", detail={"domain": p["domain"], "error": str(e)[:200]})
    else:
        S.c["no_contact"] += 1
        S.by[p["strategy"]]["no_contact"] += 1
    out = _write(S, p, dossier, draft)
    S.c["created"] += 1
    S.by[p["strategy"]]["created"] += 1
    S.rows.append({**row, **out, "dossier_chars": len(dossier), "draft": draft and draft["body"],
                   "contact_note": p["contact_note"]})


def _known_domains(db) -> set[str]:
    out: set[str] = set()
    offset = 0
    while True:  # PostgREST caps a page (1000 rows by default), so walk the whole table
        rows = db.select("companies", select="domain", order="id.asc", limit=1000, offset=offset)
        out |= {str(r["domain"]).lower() for r in rows if r.get("domain")}
        if len(rows) < 1000:
            return out
        offset += 1000


def _prompt_domains(db, S) -> str:
    rows = db.select("companies", select="domain,created_at", order="created_at.desc", limit=KNOWN_IN_PROMPT)
    seen = [str(r["domain"]).lower() for r in rows if r.get("domain")]
    seen += sorted(S.known - set(seen))
    safe = [d for d in seen if DOMAIN_RE.match(d)][:KNOWN_IN_PROMPT]
    return ", ".join(safe) or "(none yet)"


def _created_today(db, now: datetime) -> dict:
    """prospect_created actions since PKT midnight, per strategy ('legacy' for rows without one)."""
    start = now.astimezone(ZoneInfo(config.TZ)).replace(hour=0, minute=0, second=0, microsecond=0)
    out: dict = {}
    for a in db.select("actions", action="prospect_created", at=f"gte.{start.isoformat()}", limit=1000):
        sid = (a.get("detail") or {}).get("strategy") or LEGACY
        out[sid] = out.get(sid, 0) + 1
    return out


def _preferred_offers(st, slugs: list[str]) -> str:
    return ", ".join(o for o in st.offers if o in slugs) or ", ".join(slugs)


def hn_raw(c: dict, r: dict, sid: str, today: date) -> tuple[dict | None, str]:
    """S13: one scored post -> the raw dict validate() takes. Code supplies the evidence (post URL, quote, date) and
    holds the model to the domains and emails code itself extracted from the post."""
    if not r.get("keep"):
        return None, "model: " + (_one_line(r.get("reason"), 160) or "not kept")
    domain = clean_domain(str(r.get("domain") or ""))
    if not domain or domain not in c["domains"]:
        return None, "domain not among the post's own links"
    email = next((e for e in c["emails"] if e.split("@", 1)[1] == domain or e.split("@", 1)[1].endswith("." + domain)), None)
    posted = _day(c["posted_on"])
    return {"name": r.get("name"), "domain": domain, "country": r.get("country"), "sector": r.get("sector"),
            "strategy": sid, "segment": r.get("segment"), "evidence_url": c["url"],
            "evidence_quote": _one_line(c["text"], 240), "evidence_date": c["posted_on"],
            "trigger": r.get("trigger") or "Posted SEEKING FREELANCER in the Hacker News freelancer thread.",
            "trigger_type": "rfq", "headcount": 0, "post_age_days": (today - posted).days if posted else 0,
            "observation": r.get("observation"), "suggested_offer_slug": r.get("suggested_offer_slug"),
            "contact": {"email": email, "name": "", "role": "", "source_url": c["url"]} if email else None,
            "confidence": r.get("confidence")}, ""


def _hn_strategy(S, sid: str, target: int, slugs: list[str]) -> None:
    """S13: code reads the thread; a tool-less model (post text inside <untrusted>) scores batches of posts."""
    st, mine = strat.get(sid), S.by[sid]
    try:
        found = S.hn_fetch()
    except Exception as e:  # a broken feed is a failed research step, never a dead run
        S.c["research_failed"] += 1
        _log(S, "research_failed", detail={"strategy": sid, "error": f"{type(e).__name__}: {str(e)[:200]}"})
        return
    fresh = [c for c in found if any(d not in S.known for d in c["domains"])]
    S.c["returned"] += len(fresh)
    mine["returned"] += len(fresh)
    _log(S, "research_done", detail={"strategy": sid, "returned": len(fresh), "posts_matched": len(found)})
    schema = schemas.hn_score(slugs)
    for i in range(0, len(fresh), HN_BATCH):
        if mine["created"] >= target or S.budget_hit:
            return
        batch = fresh[i:i + HN_BATCH]
        system = loader.compose("hn_score", {
            "today": S.today, "strategy": sid, "strategy_name": st.name, "buyer_rules": st.buyer_rules,
            "preferred_offers": _preferred_offers(st, slugs), "slugs": ", ".join(slugs),
            "markets": ", ".join(S.markets or sorted(TARGET_MARKETS))})
        posts = json.dumps([{k: c[k] for k in ("post_id", "posted_on", "text", "domains", "emails")} for c in batch],
                           ensure_ascii=False)
        S.c["research_calls"] += 1
        mine["research_calls"] += 1
        try:
            data, _ = S.llm.ask(S.db, AGENT, S.run_id, system, posts, schema, model="haiku")
        except llm_mod.BudgetExceeded:
            S.budget_hit = True
            return
        except llm_mod.LLMError as e:
            S.c["research_failed"] += 1
            _log(S, "research_failed", detail={"strategy": sid, "error": str(e)[:200]})
            return
        if data.get("notes"):
            S.notes.append(f"{sid}: {data['notes'][:300]}")
        by_id = {c["post_id"]: c for c in batch}
        valid = []
        for r in data.get("posts") or []:
            c = by_id.pop(str(r.get("post_id")), None)   # each post we sent is judged once; unknown ids are ignored
            raw, why = (hn_raw(c, r, sid, S.today_date or datetime.now(timezone.utc).date()) if c else (None, "unknown post id"))
            p = None
            if raw is not None:
                p, why = validate(raw, sid, set(slugs), S.today_date, S.segments, S.markets, getattr(S, "named_only", False))
            if p is None:
                S.c["invalid"] += 1
                mine["invalid"] += 1
                _log(S, "prospect_dropped", detail={"strategy": sid, "reason": why, "post": (c or {}).get("url", "")})
                continue
            valid.append(p)
        fill_contacts(S, valid)
        for p in valid:
            if mine["created"] >= target or S.budget_hit:
                break
            try:
                _process(S, p)
            except Exception as e:  # one bad prospect never kills the run
                S.c["errors"] += 1
                _log(S, "prospect_error", detail={"domain": p["domain"], "error": f"{type(e).__name__}: {str(e)[:200]}"})


def _research_strategy(S, sid: str, target: int, slugs: list[str], schema: dict) -> None:
    if sid == HN_STRATEGY:
        return _hn_strategy(S, sid, target, slugs)
    st, mine = strat.get(sid), S.by[sid]
    for _ in range(CALLS_PER_STRATEGY):
        if mine["created"] >= target or S.budget_hit:
            return
        n = min(BATCH, target - mine["created"] + 2)
        system = loader.compose("prospect_research", {
            "n": n, "today": S.today, "strategy": sid, "strategy_name": st.name, "strategy_brief": st.brief,
            "queries": st.queries, "buyer_rules": st.buyer_rules, "evidence_rules": st.evidence_rules,
            "preferred_offers": _preferred_offers(st, slugs), "slugs": ", ".join(slugs),
            "offers": loader.offers_summary(), "markets": ", ".join(S.markets or sorted(TARGET_MARKETS)), "known_domains": _prompt_domains(S.db, S),
            "contact_rule": contact_rule(S)},
            preamble="preamble_research")
        S.c["research_calls"] += 1
        mine["research_calls"] += 1
        try:
            data, _ = S.llm.research(S.db, AGENT, S.run_id, system,
                                     f"Run the research task for strategy {sid}. Return up to {n} companies.",
                                     schema, model="sonnet")
        except llm_mod.BudgetExceeded:
            S.budget_hit = True
            return
        except llm_mod.LLMError as e:
            S.c["research_failed"] += 1
            _log(S, "research_failed", detail={"strategy": sid, "error": str(e)[:200]})
            return
        found = data.get("companies") or []
        if data.get("notes"):
            S.notes.append(f"{sid}: {data['notes'][:300]}")
        S.c["returned"] += len(found)
        mine["returned"] += len(found)
        _log(S, "research_done", detail={"strategy": sid, "returned": len(found), "notes": (data.get("notes") or "")[:200]})
        if not found:
            return
        valid = []
        for raw in found:
            p, why = validate(raw, sid, set(slugs), S.today_date, S.segments, S.markets, getattr(S, "named_only", False))
            if p is None:
                S.c["invalid"] += 1
                mine["invalid"] += 1
                _log(S, "prospect_dropped", detail={"strategy": sid, "reason": why,
                                                    "domain": str((raw or {}).get("domain"))[:80]})
                continue
            valid.append(p)
        fill_contacts(S, valid)
        for p in valid:
            if mine["created"] >= target or S.budget_hit:
                break
            try:
                _process(S, p)
            except Exception as e:  # one bad prospect never kills the run
                S.c["errors"] += 1
                _log(S, "prospect_error", detail={"domain": p["domain"], "error": f"{type(e).__name__}: {str(e)[:200]}"})


def run(db: DB | None = None, llm=llm_mod, settings=None, now: datetime | None = None, *,
        strategy: str | None = None, per_day: int | None = None, dry: bool = False, hn_fetch=None) -> dict:
    db = db or DB()
    settings = settings or settings_mod.Settings(db)
    now = now or datetime.now(timezone.utc)
    run_id = ledger.new_run_id()
    S = State(db, llm, run_id, dry)
    if hn_fetch is not None:   # tests pass a recorded fixture; live runs read the HN API
        S.hn_fetch = hn_fetch

    def beat(status: str, **detail) -> dict:
        out = {"run_id": run_id, **detail}
        ledger.heartbeat(db, AGENT, status, out)
        return out

    if not dry and settings.paused():
        return beat("ok", state="paused")
    S.today = now.astimezone(ZoneInfo(config.TZ)).strftime("%A %d %B %Y")
    S.today_date = now.astimezone(ZoneInfo(config.TZ)).date()
    rebalance_note = ""
    try:
        rebalance_note = maybe_rebalance(S, settings, now)
    except Exception as e:  # the weekly move must never stop the daily run
        _log(S, "quota_rebalance_failed", detail={"error": f"{type(e).__name__}: {str(e)[:200]}"})
    quotas = effective_quotas(settings.get("strategy.quotas"), per_day if per_day is not None and not dry else settings.per_day(),
                              settings.get("prospector.mix"))
    if dry:
        targets = {strategy: per_day if per_day is not None else 3}
    else:
        done = _created_today(db, now)
        targets = {sid: max(q - done.get(sid, 0), 0) for sid, q in quotas.items() if q > 0 and strategy in (None, sid)}
    targets = {sid: n for sid, n in targets.items() if n > 0}
    if not targets:
        return beat("ok", state="idle", target=0, **({"rebalance": rebalance_note} if rebalance_note else {}))
    slugs = loader.offer_slugs()
    S.known = _known_domains(db)
    S.segments = None if dry else settings.segments()
    S.markets = [m for m in settings.get("prospector.markets") if m not in settings_mod.ALWAYS_EXCLUDED]
    S.named_only = bool(settings.get("prospector.named_only"))
    order = strategy_order(list(targets), S.today_date)
    for sid in order:
        if S.budget_hit:
            break
        _research_strategy(S, sid, targets[sid], slugs, schemas.research_strategy(slugs, sid))
    status = "warn" if (S.budget_hit or S.c["errors"] or S.c["research_failed"] or S.c["dossier_failed"]
                        or S.c["draft_failed"]) else "ok"
    out = {"strategies": order, "target": sum(targets.values()), "budget_exceeded": S.budget_hit, **S.c,
           "by_strategy": S.by} | {f"{sid}_created": S.by[sid]["created"] for sid in order}
    if rebalance_note:
        out["rebalance"] = rebalance_note
    if not dry:
        out = beat(status, **out)
    else:
        out["run_id"] = run_id
    out["rows"] = S.rows
    out["research_notes"] = S.notes
    return out


# ---------------------------------------------------------------- dry run

class _DryAsk:
    """Stands in for core.llm.ask in --dry-run so only the research calls cost real model time."""

    def __init__(self, real):
        self.real = real

    def ask(self, db, agent, run_id, system, untrusted, schema, model="haiku", timeout=120):
        if "posts" in schema["properties"]:   # S13 scoring is the strategy's research step: real
            return self.real.ask(db, agent, run_id, system, untrusted, schema, model=model, timeout=timeout)
        if "body_md" in schema["properties"]:
            return {"body_md": "(dry run: dossier not generated)"}, {}
        return {"subject": "(dry run)", "body": "(dry run: draft not generated)", "notes": ""}, {}

    def research(self, *a, **k):
        return self.real.research(*a, **k)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Epsilon OS prospector")
    ap.add_argument("--dry-run", action="store_true",
                    help="research for real, write nothing, print prospects as JSON; uses an in-memory fake DB")
    ap.add_argument("--strategy", choices=settings_mod.STRATEGY_IDS,
                    help="one strategy only; required with --dry-run (each run is one or two real research calls)")
    ap.add_argument("--n", type=int, default=3, help="prospects wanted in a dry run")
    a = ap.parse_args(argv)
    if not a.dry_run:
        print({k: v for k, v in run(strategy=a.strategy).items() if k not in ("rows", "by_strategy")})  # same as launchd
        return 0
    if not a.strategy:
        ap.error("--dry-run needs --strategy (each strategy is its own real research call)")
    from tests.fakes import FakeDB
    db = FakeDB()  # never the live database
    res = run(db, _DryAsk(llm_mod), now=datetime.now(timezone.utc), strategy=a.strategy, per_day=a.n, dry=True)
    print(json.dumps(res, indent=2, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
