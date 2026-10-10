"""Outbox agent (D4, D13, DD2): sends approved drafts exactly once, never blind-resends.

approved/edited_approved -> (atomic claim, Message-ID stored in the same PATCH) -> sending -> sent | failed.
A row stuck in `sending` is resolved by looking the stored Message-ID up in the IMAP Sent folder.
"""
import smtplib
import sys
from datetime import datetime, timedelta, timezone

from core import config, ledger, mail
from core.db import DB

AGENT = "outbox"
STALE_AFTER = timedelta(minutes=10)
APPROVED = ["approved", "edited_approved"]
# Errors after which the message is certainly not delivered. Anything else (timeout, dropped
# connection) is ambiguous, so the row stays in `sending` for Sent-folder resolution.
DEFINITE = (smtplib.SMTPResponseException, smtplib.SMTPRecipientsRefused, smtplib.SMTPNotSupportedError)
UNVERIFIED = "unverified: check Sent folder"


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _log(db, run_id, action, row_id=None, detail=None) -> None:
    try:
        ledger.action(db, AGENT, run_id, action, "approval_queue", row_id, detail)
    except Exception:
        pass


def _err(e: Exception) -> str:
    return f"{type(e).__name__}: {str(e)[:200]}"


def _record_sent(db, row: dict, mid: str, body: str, now: datetime) -> None:
    db.update("approval_queue", {"status": "sent", "send_error": None}, id=row["id"], status="sending")
    db.insert("touches", {
        "type": "sent", "direction": "outbound", "channel": "email", "message_id": mid,
        "subject": row.get("subject"), "body_excerpt": body[:1000], "deal_id": row.get("deal_id"),
        "contact_id": row.get("contact_id"), "occurred_at": _iso(now),
    }, returning=False)


def _resolve_stale(db, run_id, mail_mod, now, c) -> None:
    cutoff = _iso(now - STALE_AFTER)
    for row in db.select("approval_queue", status="sending", claimed_at=f"lt.{cutoff}"):
        mid = row.get("sent_message_id")
        try:
            found = bool(mid) and mail_mod.sent_has(mid)
        except Exception as e:
            _log(db, run_id, "stale_check_failed", row["id"], {"error": _err(e)})
            c["stale_unchecked"] += 1
            continue
        if found:
            try:
                _record_sent(db, row, mid, row.get("final_text") or row.get("draft") or "", now)
            except Exception as e:
                _log(db, run_id, "record_sent_error", row["id"], {"error": _err(e)})
            c["stale_sent"] += 1
            _log(db, run_id, "stale_resolved_sent", row["id"], {"message_id": mid})
        else:
            db.update("approval_queue", {"status": "failed", "send_error": UNVERIFIED},
                      id=row["id"], status="sending")
            c["stale_failed"] += 1
            _log(db, run_id, "stale_resolved_failed", row["id"], {"message_id": mid})


def _send_one(db, run_id, mail_mod, row: dict, now: datetime, c) -> None:
    mid = mail.new_message_id()
    claimed = db.claim("approval_queue", row["id"], APPROVED, "sending",
                       {"claimed_at": _iso(now), "sent_message_id": mid})
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
        mail_mod.send({"to": to, "subject": claimed["subject"], "body": body, "message_id": mid,
                       "in_reply_to": claimed.get("in_reply_to_message_id"),
                       "references": claimed.get("references_hdr")})
    except Exception as e:
        if isinstance(e, DEFINITE):
            db.update("approval_queue", {"status": "failed", "send_error": _err(e)}, id=row["id"], status="sending")
            c["failed"] += 1
            _log(db, run_id, "send_failed", row["id"], {"error": _err(e)})
        else:
            db.update("approval_queue", {"send_error": "ambiguous: " + _err(e)}, id=row["id"], status="sending")
            c["ambiguous"] += 1
            _log(db, run_id, "send_ambiguous", row["id"], {"error": _err(e)})
        return
    c["sent"] += 1
    try:
        _record_sent(db, claimed, mid, body, now)
    except Exception as e:  # the mail is out; never mark it failed because bookkeeping broke
        _log(db, run_id, "record_sent_error", row["id"], {"error": _err(e)})
    _log(db, run_id, "sent", row["id"], {"message_id": mid})


def run(db: DB | None = None, mail_mod=mail, now: datetime | None = None) -> dict:
    db = db or DB()
    now = now or datetime.now(timezone.utc)
    run_id = ledger.new_run_id()
    c = dict.fromkeys(("candidates", "sent", "failed", "ambiguous", "lost_claim", "refused_outbound",
                       "suppressed", "stale_sent", "stale_failed", "stale_unchecked", "errors"), 0)
    try:
        _resolve_stale(db, run_id, mail_mod, now, c)
    except Exception as e:
        c["errors"] += 1
        _log(db, run_id, "stale_scan_error", detail={"error": _err(e)})

    # D7: outbound drafts are never sent from er@. Log once per row.
    try:
        for row in db.select("approval_queue", status="in.(approved,edited_approved)", kind="outbound"):
            if not db.select("actions", action="refused_outbound", target_id=row["id"], limit=1):
                _log(db, run_id, "refused_outbound", row["id"], {"reason": "D7: waits for outreach-domain sender"})
            c["refused_outbound"] += 1
    except Exception as e:
        c["errors"] += 1
        _log(db, run_id, "refuse_scan_error", detail={"error": _err(e)})

    cutoff = _iso(now - timedelta(seconds=config.UNDO_SECONDS))
    try:
        rows = db.select("approval_queue", status="in.(approved,edited_approved)", kind="neq.outbound",
                         held="eq.false", decided_at=f"lt.{cutoff}", order="decided_at.asc")
    except Exception as e:
        ledger.heartbeat(db, AGENT, "error", {"run_id": run_id, "error": _err(e)})
        return {"run_id": run_id, "error": type(e).__name__, **c}
    c["candidates"] = len(rows)
    for row in rows:
        try:
            if row.get("kind") != "optout_confirm" and row.get("to_email") and \
                    db.rpc("is_suppressed", {"addr": row["to_email"]}):
                db.update("approval_queue", {"status": "failed", "send_error": "recipient is on the suppression list"},
                          id=row["id"], status="in.(approved,edited_approved)")
                c["suppressed"] += 1
                _log(db, run_id, "send_blocked_suppressed", row["id"])
                continue
            _send_one(db, run_id, mail_mod, row, now, c)
        except Exception as e:
            c["errors"] += 1
            _log(db, run_id, "outbox_error", row.get("id"), {"error": _err(e)})
    status = "error" if c["errors"] else ("warn" if c["failed"] or c["ambiguous"] or c["stale_failed"] else "ok")
    ledger.heartbeat(db, AGENT, status, {"run_id": run_id, **c})
    return {"run_id": run_id, **c}


def main() -> int:
    print(run())
    return 0


if __name__ == "__main__":
    sys.exit(main())
