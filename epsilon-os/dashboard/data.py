"""Read side: everything the pages need, computed from the DB. No writes here."""
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from core import config
from dashboard import actions

PKT = ZoneInfo(config.TZ)
FIRST_NAME = "Ehab"
LATE_AFTER = timedelta(hours=2)
# expected run interval per known agent (seconds); amber when older than 2x
AGENTS = [("inbox", 5 * 60), ("outbox", 60), ("prospector", 3 * 86400), ("brief", 26 * 3600), ("backup", 8 * 86400)]
WATCHDOG_INTERVAL = 30 * 60
STAGES = [("lead", "Lead"), ("conversation", "Conversation"), ("scoping_call", "Scoping"),
          ("quote_out", "Quote out"), ("won_lost", "Won / Lost"), ("dormant", "Dormant")]
CHANNELS = ["referral", "inbound", "outbound", "dream25", "pre_existing"]
WEDGE_LABEL = {"fuel_retail": "W1", "industrial_monitoring": "W2", "protocol_decode": "W3", "other": "OTHER"}
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
        late = r.get("kind") == "ack" and now - created > LATE_AFTER
        out.append({
            "id": r["id"], "kind": r.get("kind") or "reply", "kind_label": KIND_LABEL.get(r.get("kind") or "reply", "REPLY"),
            "who": who or company or r.get("to_email") or "Unknown sender", "company": company if who else "",
            "to": r.get("to_email") or "", "subject": subject, "thread": r.get("subject") or "",
            "created": created, "age": ago(created, now), "late": late, "late_age": ago(created, now),
            "wedge": WEDGE_LABEL.get(wedge, ""), "channel": d.get("source_channel") or "",
            "they_wrote": t.get("body_excerpt") or "", "draft": r.get("draft") or "",
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
    beats = db.select("agent_heartbeats", order="last_run.desc", limit=300)
    latest: dict = {}
    for b in beats:
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


def shell(db, now: datetime) -> dict:
    agents, watchdog = agent_rows(db, now)
    calls, cost = calls_today(db, now)
    states = [a["state"] for a in agents]
    if "red" in states:
        status = ("red", "Agent error")
    elif "amber" in states:
        status = ("amber", "Agents partly down")
    else:
        status = ("ok", "All agents OK")
    if calls >= config.DAILY_LLM_CALL_BUDGET:
        status = ("red", "LLM budget reached")
    queue = len(db.select("approval_queue", status="pending", held="eq.false", select="id", limit=1000))
    return {"agents": agents, "watchdog": watchdog, "calls": calls, "cost": cost,
            "budget": config.DAILY_LLM_CALL_BUDGET, "status": status, "queue": queue}


# ------------------------------------------------------------------ Today

def kpis(db, now: datetime) -> dict:
    since = (now - timedelta(days=30)).isoformat()
    touches = db.select("touches", occurred_at=f"gte.{since}", limit=5000)
    human = [t for t in touches if t.get("type") == "human_reply"]
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
    parts = [f"{k.replace('_', ' ')} {v}" for k, v in detail.items()
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
    return {"runs": runs, "llm": llm, "actions": acts,
            "restore_tested": backup["detail"]["restore_tested_at"] if backup else None}
