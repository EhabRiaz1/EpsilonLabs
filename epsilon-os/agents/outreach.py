"""Outreach sender (P2): sends approved cold first touches from the separate outreach mailbox.

Separate from the outbox on purpose (D7: er@ never sends outbound). Same claim semantics: an atomic
approved -> sending claim stores a pre-generated Message-ID in the same PATCH, so a crash can be resolved by
looking that id up in the Sent folder instead of ever blind-resending.

Only kind='outbound' rows, approved, past the undo window, not held. Suppression is checked again right
before each send. The daily cap is min(settings outreach.daily_cap, warm-up ramp); the ramp clock starts
at the first successful send (settings outreach.started_on). Without outreach.address in settings and
the keychain item `epsilon-os-outreach` (account = that address) it sends nothing and says so.
"""
import sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from agents import outbox
from core import config, ledger, mail, settings
from core.db import DB

AGENT = "outreach"
APPROVED = outbox.APPROVED
PKT = ZoneInfo(config.TZ)


def _log(db, run_id, action, row_id=None, detail=None) -> None:
    outbox._log(db, run_id, action, row_id, detail, AGENT)


def pkt_midnight(now: datetime) -> datetime:
    return now.astimezone(PKT).replace(hour=0, minute=0, second=0, microsecond=0)


def sent_today(db, now: datetime) -> int:
    """Sends counted today (PKT): confirmed sends from the ledger, plus claims in flight."""
    start = pkt_midnight(now).isoformat()
    done = len(db.select("actions", agent=AGENT, action="outreach_sent", at=f"gte.{start}", select="id", limit=1000))
    flying = len(db.select("approval_queue", kind="outbound", status="sending", claimed_at=f"gte.{start}",
                           select="id", limit=1000))
    return done + flying


def status(db, now: datetime, mail_factory=None) -> dict:
    """Everything the dashboard and the run loop need to know about outreach, without sending anything."""
    mail_factory = mail_factory or mail.outreach_mailbox
    today = now.astimezone(PKT).date()
    address = settings.outreach_address(db)
    configured, why = False, ""
    if not address:
        why = "no outreach address set"
    else:
        try:
            mail_factory(address)
            configured = True
        except config.SecretError:
            why = "keychain item missing"
    ramp_cap = settings.ramp_cap(settings.ramp(db), settings.started_on(db), today)
    cap = min(settings.daily_cap(db), ramp_cap)
    return {"configured": configured, "reason": why, "address": address, "cap": cap, "ramp_cap": ramp_cap,
            "setting_cap": settings.daily_cap(db), "sent_today": sent_today(db, now),
            "started_on": settings.started_on(db)}


def _company_id(db, row: dict) -> str | None:
    if row.get("deal_id"):
        d = db.select("deals", id=row["deal_id"], limit=1)
        if d:
            return d[0].get("company_id")
    if row.get("contact_id"):
        c = db.select("contacts", id=row["contact_id"], limit=1)
        if c:
            return c[0].get("company_id")
    return None


def _send_one(db, run_id, box, address: str, row: dict, now: datetime, c) -> None:
    mid = mail.new_message_id(address.rsplit("@", 1)[-1])
    claimed = db.claim("approval_queue", row["id"], APPROVED, "sending",
                       {"claimed_at": now.isoformat(), "sent_message_id": mid})
    if claimed is None:
        c["lost_claim"] += 1
        return
    body = claimed.get("final_text") or claimed.get("draft") or ""
    to = claimed.get("to_email")
    if not to or not claimed.get("subject") or not body:
        db.update("approval_queue", {"status": "failed", "send_error": "incomplete draft (to/subject/body)"},
                  id=row["id"], status="sending")
        c["failed"] += 1
        _log(db, run_id, "send_failed", row["id"], {"error": "incomplete draft"})
        return
    try:
        box.send({"to": to, "subject": claimed["subject"], "body": body, "message_id": mid,
                  "in_reply_to": claimed.get("in_reply_to_message_id"), "references": claimed.get("references_hdr")})
    except Exception as e:
        if isinstance(e, outbox.DEFINITE):
            db.update("approval_queue", {"status": "failed", "send_error": outbox._err(e)}, id=row["id"],
                      status="sending")
            c["failed"] += 1
            _log(db, run_id, "send_failed", row["id"], {"error": outbox._err(e)})
        else:
            db.update("approval_queue", {"send_error": "ambiguous: " + outbox._err(e)}, id=row["id"],
                      status="sending")
            c["ambiguous"] += 1
            _log(db, run_id, "send_ambiguous", row["id"], {"error": outbox._err(e)})
        return
    c["sent"] += 1
    try:  # the mail is out: bookkeeping trouble must never turn it into a failure or a resend
        outbox._record_sent(db, claimed, mid, body, now)
        company_id = _company_id(db, claimed)
        if company_id:
            db.update("companies", {"last_contacted_at": now.isoformat()}, id=company_id)
        if settings.started_on(db) is None:
            settings.set(db, "outreach.started_on", now.astimezone(PKT).date().isoformat())
    except Exception as e:
        _log(db, run_id, "record_sent_error", row["id"], {"error": outbox._err(e)})
    _log(db, run_id, "outreach_sent", row["id"], {"message_id": mid})


def run(db: DB | None = None, now: datetime | None = None, mail_factory=None) -> dict:
    db = db or DB()
    now = now or datetime.now(timezone.utc)
    mail_factory = mail_factory or mail.outreach_mailbox
    run_id = ledger.new_run_id()
    c = dict.fromkeys(("candidates", "sent", "failed", "ambiguous", "lost_claim", "suppressed", "stale_sent",
                       "stale_failed", "stale_unchecked", "errors"), 0)
    address = settings.outreach_address(db)
    box = None
    if address:
        try:
            box = mail_factory(address)
        except config.SecretError:
            box = None
    if box is None:
        ledger.heartbeat(db, AGENT, "ok", {"run_id": run_id, "state": "not configured"})
        return {"run_id": run_id, "state": "not configured", **c}

    try:
        outbox._resolve_stale(db, run_id, box, now, c, kind="eq.outbound", agent=AGENT)
    except Exception as e:
        c["errors"] += 1
        _log(db, run_id, "stale_scan_error", detail={"error": outbox._err(e)})

    st = status(db, now, mail_factory=lambda a: box)
    room = st["cap"] - st["sent_today"]
    state = "ok"
    if room <= 0:
        state = "cap reached"
        rows = []
    else:
        cutoff = (now - timedelta(seconds=config.UNDO_SECONDS)).isoformat()
        try:
            rows = db.select("approval_queue", status="in.(approved,edited_approved)", kind="outbound",
                             held="eq.false", decided_at=f"lt.{cutoff}", order="decided_at.asc", limit=room)
        except Exception as e:
            ledger.heartbeat(db, AGENT, "error", {"run_id": run_id, "error": outbox._err(e)})
            return {"run_id": run_id, "error": type(e).__name__, **c}
    c["candidates"] = len(rows)
    for row in rows:
        try:
            if row.get("to_email") and db.rpc("is_suppressed", {"addr": row["to_email"]}):
                db.update("approval_queue", {"status": "failed", "send_error": "recipient is on the suppression list"},
                          id=row["id"], status="in.(approved,edited_approved)")
                c["suppressed"] += 1
                _log(db, run_id, "send_blocked_suppressed", row["id"])
                continue
            _send_one(db, run_id, box, address, row, now, c)
        except Exception as e:
            c["errors"] += 1
            _log(db, run_id, "outreach_error", row.get("id"), {"error": outbox._err(e)})
    hb = "error" if c["errors"] else ("warn" if c["failed"] or c["ambiguous"] or c["stale_failed"] else "ok")
    detail = {"run_id": run_id, "state": state, "cap": st["cap"], "sent_before": st["sent_today"], **c}
    ledger.heartbeat(db, AGENT, hb, detail)
    return detail


def main() -> int:
    print(run())
    return 0


if __name__ == "__main__":
    sys.exit(main())
