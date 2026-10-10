"""Every dashboard write lives here: small functions, each atomic against the DB, unit-tested on the fake.

Results are plain dicts: {"ok": True, ...} or {"ok": False, "error": <code>, "message": <text>, ...}.
Nothing here sends mail. Approving only moves a draft to approved/edited_approved; the outbox agent
claims it after the UNDO_SECONDS window (DD2).
"""
import difflib
import re
from collections import Counter
from datetime import datetime, timedelta, timezone

from core import config, ledger, lint, settings as cfg
from core.db import DB

AGENT = "dashboard"
APPROVED = "in.(approved,edited_approved)"
VERIFY_AFTER = timedelta(minutes=10)
MATERIAL_RATIO = 0.15

_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")
_DATEWORDS = re.compile(
    r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|mon(?:day)?|tue(?:s(?:day)?)?|"
    r"wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|tomorrow)\b", re.I)


def ok(**kw) -> dict:
    return {"ok": True, **kw}


def fail(code: str, message: str, **kw) -> dict:
    return {"ok": False, "error": code, "message": message, **kw}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def parse_ts(v) -> datetime | None:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _log(db: DB, action: str, row_id: str | None, detail: dict | None = None, strict: bool = False) -> None:
    try:
        ledger.action(db, AGENT, ledger.new_run_id(), action, "approval_queue", row_id, detail)
    except Exception:
        if strict:
            raise


def _get(db: DB, qid: str) -> dict | None:
    rows = db.select("approval_queue", id=qid)
    return rows[0] if rows else None


# ------------------------------------------------------------------ DD4: diff + material_edit

def sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT_SPLIT.split(text or "") if s.strip()]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip(" .!?,;:")


def _facts(text: str) -> Counter:
    c: Counter = Counter()
    for m in lint.URL_RE.findall(text):
        c["url:" + m.lower().rstrip(".,;")] += 1
    for m in lint.EMAIL_RE.findall(text):
        c["email:" + m.lower()] += 1
    bare = lint.EMAIL_RE.sub(" ", lint.URL_RE.sub(" ", text))
    for m in _NUM.findall(bare):
        c["num:" + m.replace(",", "")] += 1
    for m in _DATEWORDS.findall(bare):
        c["date:" + m.lower()[:3]] += 1
    return c


def compute_diff(original: str, final: str) -> dict:
    """Sentence diff on normalised text. material = >15% of sentences changed OR any changed fact."""
    a, b = sentences(original), sentences(final)
    na, nb = [_norm(s) for s in a], [_norm(s) for s in b]
    changed, removed, added = 0, [], []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, na, nb, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        changed += max(i2 - i1, j2 - j1)
        removed += a[i1:i2]
        added += b[j1:j2]
    ratio = changed / max(len(a), 1)
    fa, fb = _facts(original), _facts(final)
    fact_changes = sorted(set((fa - fb).keys()) | set((fb - fa).keys()))
    reasons = []
    if ratio > MATERIAL_RATIO:
        reasons.append(f"{changed} of {len(a)} sentences changed")
    if fact_changes:
        reasons.append("changed: " + ", ".join(k.split(":", 1)[0] for k in fact_changes[:6]))
    return {
        "changed": changed, "before": len(a), "after": len(b), "ratio": round(ratio, 3),
        "material": bool(reasons), "reasons": reasons,
        "removed": [s[:300] for s in removed[:20]], "added": [s[:300] for s in added[:20]],
    }


# ------------------------------------------------------------------ actions

def approve(db: DB, qid: str, final_text: str | None = None, confirm_lint: bool = False,
            now: datetime | None = None) -> dict:
    now = now or _now()
    row = _get(db, qid)
    if not row:
        return fail("not_found", "Draft not found.")
    if row["status"] != "pending":
        return fail("not_pending", f"Already {row['status']}.")
    if row.get("held"):
        return fail("held", "This draft is held. Release it to the deck first.")
    base = row.get("draft") or ""
    edited = final_text is not None and _norm(final_text) != _norm(base)
    text = final_text.strip() if edited else None
    effective = text if edited else base
    if not effective.strip():
        return fail("empty", "Draft is empty. Write something before sending.")
    if edited:
        hits = lint.lint(effective, {"recipient": row.get("to_email") or ""})
    else:
        hits = row.get("lint")
        if hits is None:
            hits = lint.lint(effective, {"recipient": row.get("to_email") or ""})
    if hits and not confirm_lint:
        return fail("lint_confirm_required", "Draft has lint warnings. Confirm to send anyway.", lint=hits)
    diff = compute_diff(base, text) if edited else None
    values = {
        "status": "edited_approved" if edited else "approved", "decided_at": _iso(now),
        "final_text": text if edited else None, "diff": diff,
        "material_edit": bool(diff["material"]) if edited else False,
    }
    if edited:
        values["lint"] = hits
    updated = db.update("approval_queue", values, id=qid, status="pending", held="eq.false")
    if not updated:
        return fail("not_pending", "This draft changed while you were looking at it.")
    _log(db, "approve", qid, {"edited": edited, "lint_hits": len(hits), "confirmed_lint": bool(hits),
                              "material_edit": values["material_edit"]})
    return ok(status=values["status"], edited=edited, diff=diff, decided_at=values["decided_at"],
              undo_seconds=config.UNDO_SECONDS)


def undo(db: DB, qid: str, now: datetime | None = None) -> dict:
    """approved/edited_approved -> pending, only inside the undo window and before the outbox claims it."""
    now = now or _now()
    cutoff = _iso(now - timedelta(seconds=config.UNDO_SECONDS))
    back = db.update("approval_queue",
                     {"status": "pending", "decided_at": None, "final_text": None, "diff": None,
                      "material_edit": None},
                     id=qid, status=APPROVED, decided_at=f"gte.{cutoff}")
    if back:
        _log(db, "undo", qid)
        return ok()
    row = _get(db, qid)
    if not row:
        return fail("not_found", "Draft not found.")
    if row["status"] == "pending":
        return ok(already=True)
    return fail("too_late", "Too late, already sending.")


def reject(db: DB, qid: str, reason: str | None = None, now: datetime | None = None) -> dict:
    now = now or _now()
    row = _get(db, qid)
    if not row:
        return fail("not_found", "Draft not found.")
    done = db.update("approval_queue", {"status": "rejected", "decided_at": _iso(now)}, id=qid, status="pending")
    if not done:
        return fail("not_pending", f"Already {row['status']}.")
    _log(db, "reject", qid, {"reason": (reason or "").strip()[:300] or None})
    return ok()


def later(db: DB, qid: str, now: datetime | None = None) -> dict:
    """No column for ordering, so the audit row IS the state: deck order puts 'later' items last."""
    row = _get(db, qid)
    if not row:
        return fail("not_found", "Draft not found.")
    if row["status"] != "pending":
        return fail("not_pending", f"Already {row['status']}.")
    _log(db, "later", qid, strict=True)
    return ok()


def release_held(db: DB, qid: str) -> dict:
    done = db.update("approval_queue", {"held": False}, id=qid, status="pending", held="eq.true")
    if not done:
        return fail("not_held", "Not a held draft.")
    _log(db, "release_held", qid, {"was": done[0].get("held_reason")})
    return ok()


def suppress_sender(db: DB, qid: str, now: datetime | None = None) -> dict:
    now = now or _now()
    row = _get(db, qid)
    if not row:
        return fail("not_found", "Draft not found.")
    if row["status"] != "pending":
        return fail("not_pending", f"Already {row['status']}.")
    email = (row.get("to_email") or "").strip().lower()
    if not email:
        return fail("no_address", "This draft has no recipient address to suppress.")
    if not db.select("suppression_list", email=email, limit=1):
        db.insert("suppression_list", {"email": email, "reason": "manual", "forever": True,
                                       "source_touch_id": row.get("in_reply_to_touch_id")}, returning=False)
    db.update("contacts", {"opted_out": True}, email=email)
    db.update("approval_queue", {"status": "rejected", "decided_at": _iso(now)}, id=qid, status="pending")
    _log(db, "suppress_sender", qid, {"email": email})
    return ok(email=email)


def is_verify(row: dict, now: datetime | None = None) -> bool:
    """The outbox is unsure whether this went out (stale `sending`, or failed as 'unverified')."""
    now = now or _now()
    if row.get("status") == "sending":
        t = parse_ts(row.get("claimed_at"))
        return t is not None and now - t > VERIFY_AFTER
    return row.get("status") == "failed" and str(row.get("send_error") or "").startswith("unverified")


def retry_failed(db: DB, qid: str, confirm_unverified: bool = False, now: datetime | None = None) -> dict:
    now = now or _now()
    row = _get(db, qid)
    if not row:
        return fail("not_found", "Draft not found.")
    if row["status"] not in ("failed", "sending"):
        return fail("not_failed", f"Status is {row['status']}, nothing to retry.")
    if row["status"] == "sending" and not is_verify(row, now):
        return fail("in_flight", "The outbox is sending this right now.")
    if is_verify(row, now) and not confirm_unverified:
        return fail("confirm_required", "Not sure it was sent. Check the Sent folder, then confirm to resend.")
    done = db.update("approval_queue",
                     {"status": "approved", "decided_at": _iso(now), "send_error": None, "claimed_at": None},
                     id=qid, status=row["status"])
    if not done:
        return fail("not_failed", "This draft changed while you were looking at it.")
    _log(db, "retry_failed", qid, {"from": row["status"]})
    return ok()


def mark_sent_verified(db: DB, qid: str, now: datetime | None = None) -> dict:
    now = now or _now()
    row = _get(db, qid)
    if not row:
        return fail("not_found", "Draft not found.")
    if row["status"] not in ("failed", "sending"):
        return fail("not_failed", f"Status is {row['status']}.")
    if row["status"] == "sending" and not is_verify(row, now):
        return fail("in_flight", "The outbox is sending this right now.")
    done = db.update("approval_queue", {"status": "sent", "send_error": None}, id=qid, status=row["status"])
    if not done:
        return fail("not_failed", "This draft changed while you were looking at it.")
    mid = row.get("sent_message_id")
    if mid and not db.select("touches", message_id=mid, limit=1):
        body = row.get("final_text") or row.get("draft") or ""
        db.insert("touches", {"type": "sent", "direction": "outbound", "channel": "email", "message_id": mid,
                              "subject": row.get("subject"), "body_excerpt": body[:1000],
                              "deal_id": row.get("deal_id"), "contact_id": row.get("contact_id"),
                              "occurred_at": _iso(now)}, returning=False)
    _log(db, "mark_sent_verified", qid)
    return ok()


# ------------------------------------------------------------------ settings (P3)

SETTINGS_FIELDS = {"per_day": "prospector.per_day", "daily_budget": "llm.daily_budget",
                   "daily_cap": "outreach.daily_cap"}


def save_settings(db: DB, p: dict) -> dict:
    """Validate every field first, then write. One bad field saves nothing and reports all errors inline."""
    errors, clean = {}, {}
    for field, key in SETTINGS_FIELDS.items():
        try:
            clean[key] = cfg.validate(key, str(p.get(field, "")).strip())
        except cfg.SettingsError as ex:
            errors[field] = str(ex)
    segs = p.get("segments") or []
    segs = [segs] if isinstance(segs, str) else list(segs)
    try:
        clean["prospector.segments"] = cfg.validate("prospector.segments", segs)
    except cfg.SettingsError as ex:
        errors["segments"] = str(ex)
    paused = p.get("paused")
    clean["prospector.paused"] = paused in (True, "1", "on", "true")
    if not cfg.outreach_address(db):  # once set, the address is read-only here
        try:
            addr = cfg.validate("outreach.address", p.get("address", ""))
            if addr:
                clean["outreach.address"] = addr
        except cfg.SettingsError as ex:
            errors["address"] = str(ex)
    if errors:
        return fail("invalid", "Some settings need attention.", errors=errors)
    changed = []
    for key, value in clean.items():
        if cfg.get(db, key) != value:
            cfg.set(db, key, value)
            changed.append(key)
    if changed:
        _log(db, "settings_changed", None, {"keys": changed})
    return ok(changed=changed)
