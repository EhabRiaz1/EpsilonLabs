"""Read side: everything the pages need, computed from the DB. No writes here."""
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from core import config, settings as cfg
from agents import outreach, prospector
from dashboard import actions

PKT = ZoneInfo(config.TZ)
FIRST_NAME = "Ehab"
LATE_AFTER = timedelta(hours=2)
# expected run interval per known agent (seconds); amber when older than 2x
AGENTS = [("inbox", 5 * 60), ("outbox", 60), ("prospector", 26 * 3600), ("outreach", 5 * 60), ("followups", 3600), ("brief", 26 * 3600), ("backup", 8 * 86400)]
WATCHDOG_INTERVAL = 30 * 60
STAGES = [("lead", "Lead"), ("conversation", "Conversation"), ("scoping_call", "Scoping"),
          ("quote_out", "Quote out"), ("won_lost", "Won / Lost"), ("dormant", "Dormant")]
CHANNELS = ["referral", "inbound", "outbound", "dream25", "pre_existing"]
WEDGE_LABEL = {"fuel_retail": "W1", "industrial_monitoring": "W2", "protocol_decode": "W3", "other": "OTHER"}
STRATEGY_TAG = {"s2_trigger": "S2", "s3_regulation": "S3", "s4_partner": "S4", "s5_intent": "S5", "s7_orphaned": "S7", "s8_tradeshow": "S8", "s9_crowdfund": "S9",
                "s10_accelerator": "S10", "legacy": "LEGACY"}
KIND_LABEL = {"ack": "ACK", "reply": "REPLY", "outbound": "OUTBOUND", "quote": "QUOTE", "optout_confirm": "OPT-OUT"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def inlist(ids) -> str:
    return "in.(" + ",".join(str(i) for i in ids) + ")"


def ago(dt: datetime | None, now: datetime) -> str:
    if dt is None:
        return "never"
    s = max(int((now - dt).total_seconds()), 0)
    if s < 60:
        return "now" if s < 10 else f"{s}s"
    m = s // 60
    if m < 60:
        return f"{m}m"
    h, mm = divmod(m, 60)
    if h < 24:
        return f"{h}h {mm:02d}m" if mm else f"{h}h"
    return f"{h // 24}d"


def greeting(now: datetime) -> str:
    h = now.astimezone(PKT).hour
    part = "morning" if h < 12 else ("afternoon" if h < 17 else "evening")
    return f"Good {part}, {FIRST_NAME}."


def pkt_midnight(now: datetime) -> datetime:
    return now.astimezone(PKT).replace(hour=0, minute=0, second=0, microsecond=0)


def initials(name: str) -> str:
    parts = [p for p in re.split(r"[\s,.@]+", name or "") if p and p[0].isalpha()]
    return ("".join(p[0] for p in parts[:2]) or "?").upper()


# ------------------------------------------------------------------ queue rows -> cards

def _by_id(db, table: str, ids) -> dict:
    ids = sorted({i for i in ids if i})
    return {r["id"]: r for r in db.select(table, id=inlist(ids))} if ids else {}


def enrich(db, rows: list[dict], now: datetime) -> list[dict]:
    touches = _by_id(db, "touches", [r.get("in_reply_to_touch_id") for r in rows])
    contacts = _by_id(db, "contacts", [r.get("contact_id") for r in rows])
    deals = _by_id(db, "deals", [r.get("deal_id") for r in rows])
    companies = _by_id(db, "companies", [d.get("company_id") for d in deals.values()]
                       + [c.get("company_id") for c in contacts.values()])
    parents = _by_id(db, "approval_queue", [r.get("sequence_parent") for r in rows if (r.get("sequence_step") or 0) >= 2])
    out = []
    for r in rows:
        t = touches.get(r.get("in_reply_to_touch_id")) or {}
        c = contacts.get(r.get("contact_id")) or {}
        d = deals.get(r.get("deal_id")) or {}
        co = companies.get(d.get("company_id")) or companies.get(c.get("company_id")) or {}
        created = actions.parse_ts(r.get("created_at")) or now
        who = c.get("full_name") or ""
        company = co.get("name") or ""
        label = (t.get("classifier") or {}).get("label")
        conf = (t.get("classifier") or {}).get("confidence")
        wedge = d.get("wedge") or co.get("wedge")
        subject = re.sub(r"^(re|fwd?):\s*", "", t.get("subject") or d.get("title") or r.get("subject") or "", flags=re.I)
        step = r.get("sequence_step") if (r.get("sequence_step") or 0) >= 2 else None
        parent = parents.get(r.get("sequence_parent")) or {}
        ours = (parent.get("final_text") or parent.get("draft") or "") if step else ""
        late = r.get("kind") == "ack" and now - created > LATE_AFTER
        out.append({
            "id": r["id"], "kind": r.get("kind") or "reply", "kind_label": KIND_LABEL.get(r.get("kind") or "reply", "REPLY"),
            "who": who or company or r.get("to_email") or "Unknown sender", "company": company if who else "",
            "to": r.get("to_email") or "", "subject": subject, "thread": r.get("subject") or "",
            "created": created, "age": ago(created, now), "late": late, "late_age": ago(created, now),
            "wedge": WEDGE_LABEL.get(wedge, ""), "channel": d.get("source_channel") or "",
            "step": step, "ours": ours,
            "they_wrote": t.get("body_excerpt") or ("" if step else (co.get("notes") or "" if r.get("kind") == "outbound" else "")), "draft": r.get("draft") or "",
            "classifier": (f"{label} {int(round(conf * 100))}%" if label and isinstance(conf, (int, float))
                           else (label or "—")),
            "lint": r.get("lint") or [], "held": bool(r.get("held")), "held_reason": r.get("held_reason") or "",
            "status": r.get("status"), "send_error": r.get("send_error") or "", "raw": r,
        })
    return out


def _later_times(db) -> dict:
    return {a["target_id"]: a["at"] for a in db.select("actions", action="later", order="at.asc", limit=1000)
            if a.get("target_id")}


def pending_cards(db, now: datetime, held: bool) -> list[dict]:
    rows = db.select("approval_queue", status="pending", held="eq.true" if held else "eq.false",
                     order="created_at.asc", limit=500)
    cards = enrich(db, rows, now)
    if not held:
        later = _later_times(db)
        cards.sort(key=lambda c: (c["id"] in later, later.get(c["id"], ""), c["created"]))
    return cards


def trouble_cards(db, now: datetime) -> list[dict]:
    rows = db.select("approval_queue", status="failed", order="created_at.desc", limit=50)
    stale = db.select("approval_queue", status="sending", order="created_at.desc", limit=50)
    rows += [r for r in stale if actions.is_verify(r, now)]
    cards = enrich(db, rows, now)
    for c in cards:
        c["verify"] = actions.is_verify(c["raw"], now)
    return cards


# ------------------------------------------------------------------ rail / shell

def agent_rows(db, now: datetime) -> tuple[list[dict], dict]:
    # The every-minute outbox fills any fixed window, so ask per agent (in parallel against the live DB).
    from concurrent.futures import ThreadPoolExecutor
    names = [a for a, _ in AGENTS] + ["watchdog", "tenders", "followups"]
    def one(name):
        rows = db.select("agent_heartbeats", agent=name, order="last_run.desc", limit=1)
        return rows[0] if rows else None
    if type(db).__name__ == "DB":
        with ThreadPoolExecutor(max_workers=len(names)) as ex:
            found = list(ex.map(one, names))
    else:
        found = [one(nm) for nm in names]
    latest: dict = {b["agent"]: b for b in found if b}
    for b in db.select("agent_heartbeats", order="last_run.desc", limit=300):
        latest.setdefault(b["agent"], b)
    rows = []
    known = {a for a, _ in AGENTS}
    for name, interval in AGENTS + [(a, 86400) for a in sorted(latest) if a not in known and a != "watchdog"]:
        b = latest.get(name)
        if not b:
            rows.append({"name": name, "state": "idle", "text": "not started", "age": None})
            continue
        t = actions.parse_ts(b["last_run"])
        age = (now - t).total_seconds() if t else 1e12
        if b.get("status") == "error":
            state = "red"
        elif b.get("status") == "warn" or age > 2 * interval:
            state = "amber"
        else:
            state = "ok"
        rows.append({"name": name, "state": state, "text": f"{b.get('status')} · {ago(t, now)}", "age": age})
    wd = latest.get("watchdog")
    if wd:
        t = actions.parse_ts(wd["last_run"])
        stale = (now - t).total_seconds() > 2 * WATCHDOG_INTERVAL if t else True
        watchdog = {"state": "amber" if stale else "ok", "text": f"last ping {ago(t, now)} ago"}
    else:
        watchdog = {"state": "idle", "text": "not set up"}
    return rows, watchdog


def calls_today(db, now: datetime) -> tuple[int, float]:
    rows = db.select("actions", action="llm_call", at=f"gte.{pkt_midnight(now).isoformat()}", limit=5000)
    return len(rows), sum(float(r.get("cost_usd") or 0) for r in rows)


def prospected_today(db, now: datetime) -> int:
    rows = db.select("actions", action="prospect_created", at=f"gte.{pkt_midnight(now).isoformat()}", select="id", limit=1000)
    return len(rows)


def shell(db, now: datetime) -> dict:
    agents, watchdog = agent_rows(db, now)
    calls, cost = calls_today(db, now)
    budget = cfg.daily_budget(db)
    states = [a["state"] for a in agents]
    if "red" in states:
        status = ("red", "Agent error")
    elif "amber" in states:
        status = ("amber", "Agents partly down")
    elif not [a for a in agents if a["state"] in ("ok", "amber", "red")]:
        status = ("idle", "Agents not started")
    else:
        status = ("ok", "All agents OK")
    if calls >= budget:
        status = ("red", "LLM budget reached")
    queue = len(db.select("approval_queue", status="pending", held="eq.false", select="id", limit=1000))
    return {"agents": agents, "watchdog": watchdog, "calls": calls, "cost": cost,
            "budget": budget, "status": status, "queue": queue, "prospected": prospected_today(db, now),
            "tenders": tenders_summary(db, now)}


# ------------------------------------------------------------------ Today

def kpis(db, now: datetime) -> dict:
    since = (now - timedelta(days=30)).isoformat()
    touches = db.select("touches", occurred_at=f"gte.{since}", limit=5000)
    human = [t for t in touches if t.get("type") == "human_reply" and t.get("direction") == "inbound"]
    convs = len({t["deal_id"] for t in human if t.get("deal_id")})
    sent = sum(1 for t in touches if t.get("type") == "sent" and t.get("direction") == "outbound")
    interested = sum(1 for t in human if (t.get("classifier") or {}).get("label") == "inquiry")
    quotes = db.select("deals", stage="quote_out", limit=1000)
    collected = db.select("deals", collected_at=f"gte.{since}", limit=1000)
    week = (now - timedelta(days=7)).isoformat()
    conv_week = len({t["deal_id"] for t in human if t.get("deal_id") and t["occurred_at"] >= week})
    return {
        "conversations": convs, "conv_week": conv_week,
        "quotes": len(quotes), "quotes_value": sum(float(d.get("value_usd") or 0) for d in quotes),
        "collected": sum(float(d.get("value_usd") or 0) for d in collected),
        "won_q4": sum(float(d.get("value_usd") or 0) for d in db.select("deals", stage="won", closed_at="gte.2026-10-01", limit=1000)),
        "interested_pct": (interested / sent * 100) if sent else None, "sent": sent, "interested": interested,
    }


def last_sent(db, now: datetime) -> str | None:
    rows = db.select("touches", type="sent", order="occurred_at.desc", limit=1)
    return ago(actions.parse_ts(rows[0]["occurred_at"]), now) if rows else None


def decided_today(db, now: datetime) -> dict:
    rows = db.select("approval_queue", decided_at=f"gte.{pkt_midnight(now).isoformat()}", limit=1000)
    sent = sum(1 for r in rows if r["status"] in ("approved", "edited_approved", "sending", "sent"))
    return {"sent": sent, "rejected": sum(1 for r in rows if r["status"] == "rejected")}


def money(v: float) -> str:
    return f"${v / 1000:.1f}k" if v >= 10000 else f"${v:,.0f}"


# ------------------------------------------------------------------ Pipeline

def pipeline(db, now: datetime, channel: str | None) -> dict:
    filt = {"order": "updated_at.desc", "limit": 1000}
    if channel in CHANNELS:
        filt["source_channel"] = channel
    deals = db.select("deals", **filt)
    companies = _by_id(db, "companies", [d["company_id"] for d in deals])
    ids = [d["id"] for d in deals]
    latest: dict = {}
    if ids:
        for t in db.select("touches", deal_id=inlist(ids), order="occurred_at.desc", limit=3000):
            latest.setdefault(t["deal_id"], t)
    groups = {k: [] for k, _ in STAGES}
    for d in deals:
        since = actions.parse_ts(d.get("updated_at")) or actions.parse_ts(d.get("created_at")) or now
        days = max((now - since).days, 0)
        t = latest.get(d["id"])
        row = {"id": d["id"], "company": (companies.get(d["company_id"]) or {}).get("name") or d["title"],
               "title": d["title"], "channel": d["source_channel"], "value": d.get("value_usd"),
               "strategy": d.get("strategy") or "",
               "days": days, "stage": d["stage"], "next": (t or {}).get("subject") or "",
               "tone": "red" if days > 14 else ("amber" if days > 7 else "")}
        groups["won_lost" if d["stage"] in ("won", "lost") else d["stage"]].append(row)
    return {"groups": groups, "total": len(deals)}


def deal_panel(db, deal_id: str, now: datetime) -> dict | None:
    rows = db.select("deals", id=deal_id)
    if not rows:
        return None
    d = rows[0]
    co = (db.select("companies", id=d["company_id"]) or [{}])[0]
    contacts = db.select("contacts", company_id=d["company_id"], limit=20)
    touches = db.select("touches", deal_id=deal_id, order="occurred_at.desc", limit=10)
    for t in touches:
        t["age"] = ago(actions.parse_ts(t.get("occurred_at")), now)
    return {"deal": d, "company": co, "contacts": contacts, "touches": touches}


# ------------------------------------------------------------------ Health

def fmt_detail(detail) -> tuple[str, str]:
    """(counts text, error text) from a heartbeat detail blob."""
    if not isinstance(detail, dict):
        return "", ""
    err = str(detail.get("error") or "")
    parts = ([str(detail["state"])] if isinstance(detail.get("state"), str) else []) + [f"{k.replace('_', ' ')} {v}" for k, v in detail.items()
             if isinstance(v, int) and not isinstance(v, bool) and v and k != "errors"]
    if detail.get("errors"):
        parts.append(f"errors {detail['errors']}")
    return " · ".join(parts), err


def health(db, now: datetime) -> dict:
    names = [a for a, _ in AGENTS]
    beats = db.select("agent_heartbeats", order="last_run.desc", limit=600)
    seen = set(b["agent"] for b in beats) | set(names)
    runs = {}
    for a in sorted(seen):
        mine = [b for b in beats if b["agent"] == a][:20]
        for b in mine:
            b["age"] = ago(actions.parse_ts(b["last_run"]), now)
            b["counts"], b["err"] = fmt_detail(b.get("detail"))
        runs[a] = mine
    since = (pkt_midnight(now) - timedelta(days=13)).isoformat()
    per_day: dict = defaultdict(int)
    for r in db.select("actions", action="llm_call", at=f"gte.{since}", limit=10000):
        t = actions.parse_ts(r["at"])
        if t:
            per_day[t.astimezone(PKT).date()] += 1
    today = now.astimezone(PKT).date()
    days = [(today - timedelta(days=i)) for i in range(13, -1, -1)]
    llm = [(d, per_day.get(d, 0)) for d in days]
    acts = db.select("actions", order="at.desc", limit=50)
    for a in acts:
        a["age"] = ago(actions.parse_ts(a["at"]), now)
    backup = next((b for b in beats if b["agent"] == "backup"
                   and isinstance(b.get("detail"), dict) and b["detail"].get("restore_tested_at")), None)
    return {"runs": runs, "llm": llm, "actions": acts, "strategies": strategies_block(db, now),
            "restore_tested": backup["detail"]["restore_tested_at"] if backup else None}


def strategies_block(db, now: datetime) -> dict:
    """Health page 'Strategies': 30-day numbers per strategy (prospector.strategy_stats), the quota, and the rebalance note."""
    stats = prospector.strategy_stats(db, now, (30,))
    quotas, pinned, auto = cfg.quotas(db), cfg.pinned(db), cfg.auto_rebalance(db)
    rows = []
    for sid in list(cfg.STRATEGY_IDS) + [prospector.LEGACY]:
        m = stats[sid][30]
        if sid == prospector.LEGACY and not (m["created"] or m["sent"] or m["replies"]):
            continue
        rows.append({"id": sid, "name": cfg.STRATEGY_LABEL.get(sid, "Legacy (segment search)"), "tag": STRATEGY_TAG[sid],
                     "quota": quotas.get(sid), "pinned": sid in pinned, **m})
    eligible = sum(1 for sid in cfg.STRATEGY_IDS if stats[sid][30]["sent"] >= prospector.MIN_SENDS)
    _, last = prospector.rebalance_actions(db, now)
    start = pkt_midnight(now)
    checked = bool(last) and (actions.parse_ts(last[0].get("at")) or start) >= start
    moved = db.select("actions", agent="prospector", action="quota_rebalanced", order="at.desc", limit=1)
    if not auto:
        note = "Auto-rebalance is off. Quotas stay as set."
    else:
        nxt = prospector.next_rebalance(now, checked)
        note = (f"Next rebalance: {nxt.strftime('%a %d %b')}. It moves up to {prospector.REBALANCE_STEP} quota a week toward the best "
                f"positive-reply rate, once at least two strategies have {prospector.MIN_SENDS} sends in 30 days "
                f"({eligible} of {len(cfg.STRATEGY_IDS)} there now).")
    if moved:
        dt = moved[0].get("detail") or {}
        note += (f" Last change {ago(actions.parse_ts(moved[0]['at']), now)} ago: {dt.get('moved')} from "
                 f"{cfg.STRATEGY_LABEL.get(dt.get('from'), '?')} to {cfg.STRATEGY_LABEL.get(dt.get('to'), '?')}.")
    return {"rows": rows, "note": note, "per_day": cfg.per_day(db)}


# ------------------------------------------------------------------ Settings

def settings_view(db, now: datetime) -> dict:
    return {
        "per_day": cfg.per_day(db), "segments": cfg.segments(db), "paused": cfg.paused(db),
        "daily_budget": cfg.daily_budget(db), "daily_cap": cfg.daily_cap(db), "address": cfg.outreach_address(db),
        "outreach": outreach.status(db, now), "calls": calls_today(db, now)[0],
        "prospected": prospected_today(db, now),
        "markets": cfg.markets(db), "quotas": cfg.quotas(db), "auto_rebalance": cfg.auto_rebalance(db), "pinned": cfg.pinned(db),
    }


# ------------------------------------------------------------------ Opportunities (S1 tenders)

WORTH_A_LOOK = 60
LOW_FIT = 40
ELIG_BADGE = {"ok": ("OK", "sig"), "flag": ("CHECK", "amber"), "exclude": ("EXCLUDED", "red")}


def fmt_amount(v) -> str:
    v = float(v)
    if v >= 1_000_000:
        return f"{v / 1_000_000:.1f}M".replace(".0M", "M")
    if v >= 1000:
        return f"{v / 1000:.0f}k"
    return f"{v:.0f}"


def opp_value(row: dict) -> str:
    lo, hi, cur = row.get("value_min"), row.get("value_max"), row.get("currency") or ""
    if not lo and not hi:
        return "Not stated"
    lo, hi = lo or hi, hi or lo
    amt = fmt_amount(lo) if float(lo) == float(hi) else f"{fmt_amount(lo)}-{fmt_amount(hi)}"
    return f"{cur} {amt}".strip()


def countdown(deadline, now: datetime) -> tuple[str, str]:
    d = actions.parse_ts(deadline)
    if d is None:
        return "No deadline stated", ""
    days = (d - now).total_seconds() / 86400
    if days < 0:
        return "Closed", "red"
    if days < 1:
        return "Closes today", "red"
    n = int(days)
    return f"{n}d left", "red" if n < 5 else ("amber" if n < 10 else "")


def safe_url(u) -> str:
    u = str(u or "")
    return u if u.startswith(("https://", "http://")) and " " not in u else ""


def offer_name(slug) -> str:
    if not slug:
        return ""
    try:
        import json as _json
        from prompts import loader
        for o in _json.loads(loader.CATALOGUE.read_text()).get("offers", []):
            if o.get("slug") == slug:
                return o.get("name", slug)
    except Exception:
        pass
    return str(slug)


def opp_card(r: dict, now: datetime) -> dict:
    fit = r.get("fit") or {}
    el = fit.get("eligibility") or {}
    status = el.get("status") if el.get("status") in ELIG_BADGE else "ok"
    badge, tone = ELIG_BADGE[status]
    text, cd_tone = countdown(r.get("deadline_at"), now)
    slug = fit.get("offer_slug")
    return {
        "id": r["id"], "title": r.get("title") or "", "buyer": r.get("buyer") or "", "country": r.get("country") or "",
        "source": cfg.TENDER_SOURCE_LABEL.get(r.get("source"), r.get("source") or ""), "score": int(fit.get("score") or 0),
        "offer": offer_name(slug), "offer_slug": slug, "value": opp_value(r),
        "deadline": text, "deadline_tone": cd_tone, "badge": badge, "badge_tone": tone, "elig_status": status,
        "elig_notes": list(el.get("notes") or []), "status": r.get("status"), "url": safe_url(r.get("url")),
        "summary": r.get("summary") or "", "reasons": list(fit.get("reasons") or []),
        "requirements": list(fit.get("requirements") or []), "what_we_need": list(fit.get("what_we_need") or []),
        "effort": fit.get("effort") or "", "notes": r.get("notes") or "", "cpv": list(r.get("cpv_or_naics") or [])[:8],
        "published": (r.get("published_at") or "")[:10], "deadline_date": (r.get("deadline_at") or "")[:10],
    }


def opportunities(db, now: datetime) -> dict:
    new = [opp_card(r, now) for r in db.select("opportunities", status="new", limit=500)]
    new.sort(key=lambda c: (-c["score"], c["deadline"]))
    active = [opp_card(r, now) for r in db.select("opportunities", status="in.(bid,submitted)", limit=200)]
    closed = db.select("opportunities", status="in.(won,lost)", select="status", limit=500)
    return {"new": new, "active": active, "won": sum(1 for r in closed if r["status"] == "won"),
            "lost": sum(1 for r in closed if r["status"] == "lost"),
            "passed": len(db.select("opportunities", status="pass", select="id", limit=5000))}


def opportunity(db, oid: str, now: datetime) -> dict | None:
    rows = db.select("opportunities", id=oid)
    return opp_card(rows[0], now) if rows else None


def tenders_summary(db, now: datetime) -> dict | None:
    """For the Today right rail. None when the table is not migrated yet, so the page still renders."""
    try:
        rows = db.select("opportunities", status="new", limit=1000)
    except Exception:
        return None
    worth = sum(1 for r in rows if int(((r.get("fit") or {}).get("score")) or 0) >= WORTH_A_LOOK)
    return {"new": len(rows), "worth": worth}


def tenders_settings(db) -> dict:
    return {"per_day": cfg.tenders_per_day(db), "value_min": cfg.get(db, "tenders.value_min"),
            "value_max": cfg.get(db, "tenders.value_max"), "sources": cfg.tenders_sources(db),
            "paused": cfg.tenders_paused(db)}


def tenders_form_draft(base: dict, p: dict) -> dict:
    """Submitted values over the saved ones, for re-rendering the form after a validation error."""
    srcs = p.get("tenders_sources") or []
    return {**base, "per_day": p.get("tenders_per_day", base["per_day"]),
            "value_min": p.get("tenders_value_min", base["value_min"]),
            "value_max": p.get("tenders_value_max", base["value_max"]),
            "sources": [srcs] if isinstance(srcs, str) else list(srcs),
            "paused": p.get("tenders_paused") in ("1", "on", "true")}
