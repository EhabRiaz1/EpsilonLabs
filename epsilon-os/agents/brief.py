"""Daily CEO brief (PLAN §3.4): deterministic text from data, no LLM calls.

Order: health block, Needs you, funnel (+ Monday leading indicators), stalled deals.
A missing brief by 9am PKT is itself the alarm.
"""
import html
import sys
from datetime import datetime, timedelta, timezone

from core import config, ledger, mail
from core.db import DB
from dashboard import actions, data

AGENT = "brief"
STALL_DAYS = 14
OPEN_STAGES = ("lead", "conversation", "scoping_call", "quote_out")


def _already_sent(db, now: datetime) -> bool:
    return bool(db.select("actions", action="brief_sent", at=f"gte.{data.pkt_midnight(now).isoformat()}", limit=1))


def _llm_yesterday(db, now: datetime) -> int:
    end = data.pkt_midnight(now)
    start = end - timedelta(days=1)
    rows = db.select("actions", action="llm_call", at=f"gte.{start.isoformat()}", limit=5000)
    return sum(1 for r in rows if (t := actions.parse_ts(r["at"])) and t < end)


def _weekly(db, now: datetime, k: dict) -> dict:
    week = (now - timedelta(days=7)).isoformat()
    won = db.select("deals", collected_at=f"gte.{week}", limit=1000)
    sent = db.select("touches", type="sent", occurred_at=f"gte.{week}", limit=5000)
    deal_ids = sorted({t["deal_id"] for t in sent if t.get("deal_id")})
    refs = db.select("deals", id=data.inlist(deal_ids), source_channel="referral") if deal_ids else []
    ref_ids = {d["id"] for d in refs}
    return {"conversations": k["conv_week"], "quotes_out": k["quotes"],
            "closed": sum(float(d.get("value_usd") or 0) for d in won),
            "interested_pct": k["interested_pct"],
            "referral_asks": sum(1 for t in sent if t.get("deal_id") in ref_ids)}


def gather(db, now: datetime) -> dict:
    shell = data.shell(db, now)
    inbox_beat = next(iter(db.select("agent_heartbeats", agent="inbox", order="last_run.desc", limit=1)), None)
    detail = (inbox_beat or {}).get("detail") or {}
    unprocessed = int(detail.get("unprocessed") or 0) if isinstance(detail, dict) else 0
    trouble = data.trouble_cards(db, now)
    pending = sorted(data.pending_cards(db, now, held=False), key=lambda c: c["created"])
    held = len(data.pending_cards(db, now, held=True))
    k = data.kpis(db, now)
    stalled = [r for rows in data.pipeline(db, now, None)["groups"].values() for r in rows
               if r["stage"] in OPEN_STAGES and r["days"] > STALL_DAYS]
    stalled.sort(key=lambda r: -r["days"])
    yesterday = _llm_yesterday(db, now)
    issues = []
    for a in shell["agents"]:
        if a["state"] in ("red", "amber"):
            issues.append(f"{a['name']}: {a['text']}" + (" (silent too long)" if a["state"] == "amber" else ""))
    if unprocessed:
        issues.append(f"{unprocessed} inbox messages unprocessed")
    for c in trouble:
        issues.append(f"send {'unverified' if c.get('verify') else 'failed'}: {c['to'] or c['who']}")
    budget = shell["budget"]
    if yesterday >= budget:
        issues.append(f"LLM budget reached yesterday ({yesterday}/{budget})")
    if shell["watchdog"]["state"] == "amber":
        issues.append(f"watchdog: {shell['watchdog']['text']}")
    local = now.astimezone(data.PKT)
    return {"now": now, "date": local.date().isoformat(), "shell": shell, "unprocessed": unprocessed,
            "trouble": trouble, "pending": pending, "held": held, "kpis": k, "stalled": stalled,
            "llm_yesterday": yesterday, "issues": issues,
            "weekly": _weekly(db, now, k) if local.weekday() == 0 else None}


def subject(g: dict) -> str:
    n = len(g["issues"])
    return f"Epsilon brief · {n} issue{'s' if n != 1 else ''}" if n else "Epsilon brief · all clear"


def _pct(v) -> str:
    return "n/a" if v is None else f"{v:.0f}%"


def sections(g: dict) -> list[tuple[str, list[str]]]:
    s, k, now = g["shell"], g["kpis"], g["now"]
    health = [f"{a['name']}: {a['text']} [{a['state']}]" for a in s["agents"]]
    health += [f"Unprocessed inbox: {g['unprocessed']}",
               f"Failed or unverified sends: {len(g['trouble'])}",
               f"Held for review: {g['held']}",
               f"LLM calls yesterday: {g['llm_yesterday']} / {s['budget']}",
               f"Watchdog: {s['watchdog']['text']} [{s['watchdog']['state']}]"]
    if g["issues"]:
        health = ["ISSUES: " + "; ".join(g["issues"])] + health
    need = [f"{len(g['pending'])} waiting for your approval" if g["pending"] else "Nothing waiting. Queue is clear."]
    need += [f"{c['who']} · {c['subject'] or c['thread'] or '(no subject)'} · {c['age']}" for c in g["pending"][:5]]
    need.append(f"Open the deck: {config.DASHBOARD_URL}")
    funnel = [f"Conversations (30d): {k['conversations']}",
              f"Quotes out: {k['quotes']} ({data.money(k['quotes_value'])})",
              f"Collected (30d): {data.money(k['collected'])}",
              f"Interested-reply rate (30d): {_pct(k['interested_pct'])} ({k['interested']} of {k['sent']} sent)"]
    out = [("Health", health), ("Needs you", need), ("Funnel, last 30 days", funnel)]
    w = g["weekly"]
    if w:
        out.append(("Weekly leading indicators", [
            f"New conversations: {w['conversations']}", f"Quotes out: {w['quotes_out']}",
            f"$ closed this week: {data.money(w['closed'])}",
            f"Interested-reply rate: {_pct(w['interested_pct'])}", f"Referral asks sent: {w['referral_asks']}"]))
    stalled = [f"{r['company']} · {r['stage'].replace('_', ' ')} · {r['days']}d" for r in g["stalled"][:10]]
    out.append((f"Stalled deals (over {STALL_DAYS} days in stage)", stalled or ["None."]))
    return out


def render_text(g: dict) -> str:
    parts = [f"{data.greeting(g['now'])} {g['date']}", ""]
    for title, lines in sections(g):
        parts += [title.upper(), *[f"- {x}" for x in lines], ""]
    return "\n".join(parts)


def render_html(g: dict) -> str:
    e = html.escape
    body = [f"<p>{e(data.greeting(g['now']))} {e(g['date'])}</p>"]
    for title, lines in sections(g):
        body.append(f"<h3 style=\"margin:16px 0 4px\">{e(title)}</h3><ul style=\"margin:0;padding-left:18px\">"
                    + "".join(f"<li>{e(x)}</li>" for x in lines) + "</ul>")
    return ("<html><body style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;"
            "color:#111\">" + "".join(body) + "</body></html>")


def run(db: DB | None = None, mail_mod=mail, now: datetime | None = None) -> dict:
    db = db or DB()
    now = now or datetime.now(timezone.utc)
    if _already_sent(db, now):
        return {"skipped": "already sent today"}
    run_id = ledger.new_run_id()
    g = gather(db, now)
    subj = subject(g)
    mid = mail.new_message_id()
    try:
        mail_mod.send({"to": config.founder_email(), "subject": subj, "body": render_text(g),
                       "html": render_html(g), "message_id": mid})
    except Exception as e:
        ledger.heartbeat(db, AGENT, "error", {"run_id": run_id, "error": f"send failed: {type(e).__name__}"})
        return {"run_id": run_id, "error": type(e).__name__}
    ledger.action(db, AGENT, run_id, "brief_sent", detail={"message_id": mid, "issues": len(g["issues"])})
    ledger.heartbeat(db, AGENT, "warn" if g["issues"] else "ok",
                     {"run_id": run_id, "issues": len(g["issues"]), "message_id": mid})
    return {"run_id": run_id, "subject": subj, "issues": len(g["issues"]), "message_id": mid}


def main() -> int:
    print(run())
    return 0


if __name__ == "__main__":
    sys.exit(main())
