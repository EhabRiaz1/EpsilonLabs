"""Follow-up sequence: day 0 first touch, day 4 follow-up 2, day 9 follow-up 3 (Asia/Karachi calendar days).

Only prospector first touches that were actually sent start a sequence. Step 2 is queued 4 PKT calendar days
after step 1 went out, step 3 is queued 5 days after step 2 went out. Nothing is sent here: each follow-up lands
in approval_queue as a pending kind='outbound' draft with sequence_step and sequence_parent, and the founder
approves it like any other draft. The outreach sender then sends due follow-ups before first touches.

A sequence stops, silently and for good, as soon as any of these is true: the contact wrote back (human_reply,
opt_out or bounce; pure out-of-office auto_reply is ignored), the contact is opted out, the address is suppressed,
or the deal is no longer a plain lead. `stop_reason` is the single place that decides this; it runs when drafting
and again inside outreach right before a follow-up is claimed. `expire_sequence` is what inbox calls the moment a
reply, opt-out or bounce is logged, so a pending or approved-but-unsent follow-up never goes out.

Idempotency: a draft in any status (even rejected or expired) for (first touch, step) means that step is done.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from core import config, ledger, lint, llm as llm_mod
from core.db import DB
from prompts import loader, schemas

AGENT = "followups"
RUN_ACTION = "followups_run"
PKT = ZoneInfo(config.TZ)
GAP_DAYS = {2: 4, 3: 5}            # days after the previous step's send
MAX_WORDS = {2: 70, 3: 50}         # whole email, greeting and last line included
GATE = timedelta(hours=1)
STALE_DAYS = 14                    # a step this far past its due date (long outage) is dropped, not sent late
STOP_TYPES = "in.(human_reply,opt_out,bounce)"
LIVE = ["pending", "approved", "edited_approved"]
OPT_OUT_LINE = "Reply 'stop' and I won't write again."

STEP_RULES = {
    2: ("This is follow-up 2, sent 4 days after the first email. At most 70 words in total, counting the greeting, "
        "the sign-off and the last line (aim for 55 to 65). Do not restate the first email. Bring exactly one new "
        "angle, taken only from the offer text below: either one concrete deliverable, or one relevant proof point, "
        "tied to the prospect's situation in the facts. Then the same soft ask as before: a 20-minute call, or they "
        "can suggest a time or say no."),
    3: ("This is follow-up 3, the last one, sent 5 days after follow-up 2. At most 50 words in total, counting the "
        "greeting, the sign-off and the last line (aim for 35 to 45). No new pitch and no new claim. A polite "
        "close-the-loop: say you will leave it here, and that if <their need, in a few words from the facts> comes "
        "back they can reply and you will pick it up."),
}


def _ts(v) -> datetime | None:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _log(db, run_id, action, row_id=None, detail=None, agent=AGENT) -> None:
    try:
        ledger.action(db, agent, run_id, action, "approval_queue" if row_id else None, row_id, detail)
    except Exception:
        pass  # logging must never kill the run


# ---------------------------------------------------------------- rules (pure-ish, shared with outreach and inbox)

def is_first_touch(row: dict) -> bool:
    """A prospector cold email. Inbox replies on the outreach mailbox are also kind 'outbound' but never start a sequence."""
    return (row.get("agent") == "prospector" and row.get("kind") == "outbound" and not row.get("sequence_parent")
            and (row.get("sequence_step") or 1) == 1)


def sent_at(db, row: dict) -> datetime | None:
    """When this row's email went out: the 'sent' touch carrying its Message-ID, else the claim time."""
    mid = row.get("sent_message_id")
    if mid:
        t = db.select("touches", message_id=mid, select="occurred_at", limit=1)
        if t and _ts(t[0].get("occurred_at")):
            return _ts(t[0]["occurred_at"])
    return _ts(row.get("claimed_at"))


def due_on(sent: datetime, step: int):
    """PKT calendar date from which `step` is due, given when the previous step went out."""
    return sent.astimezone(PKT).date() + timedelta(days=GAP_DAYS[step])


def is_due(sent: datetime, step: int, now: datetime) -> bool:
    return now.astimezone(PKT).date() >= due_on(sent, step)


def stop_reason(db, contact: dict | None, deal: dict | None, since: datetime | None) -> str | None:
    """Why a sequence for this contact must not continue, or None. `since` is when the first touch went out."""
    if not contact or not contact.get("email"):
        return "no contact address"
    if contact.get("opted_out"):
        return "contact opted out"
    if db.rpc("is_suppressed", {"addr": contact["email"]}):
        return "address suppressed"
    if not deal:
        return "no deal"
    if deal.get("stage") != "lead":
        return f"deal is {deal.get('stage')}"
    if since is None:
        return "first send time unknown"
    cut = since.isoformat()
    for key, val in (("contact_id", contact["id"]), ("deal_id", deal["id"])):
        hit = db.select("touches", **{key: val}, direction="inbound", type=STOP_TYPES, occurred_at=f"gte.{cut}",
                        select="type", limit=1)
        if hit:
            return f"inbound {hit[0]['type']}"
    return None


def stop_reason_for_row(db, row: dict) -> str | None:
    """Re-check a queued follow-up (step 2 or 3) against the live state. Used by outreach right before the claim."""
    parent = db.select("approval_queue", id=row["sequence_parent"], limit=1) if row.get("sequence_parent") else []
    if not parent:
        return "first touch not found"
    first = parent[0]
    contact = (db.select("contacts", id=first["contact_id"], limit=1) or [None])[0] if first.get("contact_id") else None
    deal = (db.select("deals", id=first["deal_id"], limit=1) or [None])[0] if first.get("deal_id") else None
    return stop_reason(db, contact, deal, sent_at(db, first))


def expire_sequence(db, agent: str, run_id: str, *, contact_id=None, deal_id=None, email=None, reason: str) -> int:
    """Expire every pending / approved-but-unsent follow-up (step 2 or 3) for this contact, deal or address.

    Selects without the sequence columns and filters in Python, so inbox keeps working even before migration 005.
    """
    finds = [("contact_id", contact_id), ("deal_id", deal_id), ("to_email", email)]
    seen: dict[str, dict] = {}
    for col, val in finds:
        if not val:
            continue
        for r in db.select("approval_queue", **{col: val}, kind="outbound", status=f"in.({','.join(LIVE)})", limit=100):
            if (r.get("sequence_step") or 0) >= 2:
                seen[r["id"]] = r
    n = 0
    for rid, r in seen.items():
        done = db.update("approval_queue", {"status": "expired"}, id=rid, status=f"in.({','.join(LIVE)})")
        if done:
            n += 1
            _log(db, run_id, "sequence_expired", rid,
                 {"reason": reason, "step": r.get("sequence_step"), "was": r.get("status")}, agent)
    return n


# ---------------------------------------------------------------- drafting

def finish(body: str, step: int) -> tuple[str, list[str]]:
    """Force the exact opt-out ending and report problems that should hold the draft."""
    text = body.replace("’", "'").strip()
    problems = []
    if not text.endswith(OPT_OUT_LINE):
        text = text.rstrip() + "\n\n" + OPT_OUT_LINE
    words = len(text.split())
    if words > MAX_WORDS[step]:
        problems.append(f"{words} words (limit {MAX_WORDS[step]})")
    return text, problems


def _offer_slug(db, first: dict) -> str | None:
    for a in db.select("actions", action="draft_queued", target_id=first["id"], limit=1):
        slug = (a.get("detail") or {}).get("offer")
        if slug:
            return slug
    return None


def _focus(db, first: dict) -> str:
    slug = _offer_slug(db, first)
    try:
        return loader.offer_detail(slug) if slug else loader.offers_summary()
    except KeyError:
        return loader.offers_summary()


def subject_for(first: dict) -> str:
    s = (first.get("subject") or "").strip()
    while s.lower().startswith("re:"):
        s = s[3:].strip()
    return "Re: " + s


def _compose(db, llm, run_id, step: int, first: dict, prev_rows: list[dict], contact: dict, deal: dict):
    co = (db.select("companies", id=deal["company_id"], limit=1) or [{}])[0] if deal.get("company_id") else {}
    from agents.inbox import first_name  # inbox imports this module, so import it late
    fn = first_name(contact.get("full_name") or "")
    ctx = (f"follow-up {step} of 3; first name: {fn if fn != 'there' else '(none, use \"Hi,\")'}; "
           f"company: {co.get('name') or 'unknown'}; country: {co.get('country') or 'unknown'}")
    system = loader.compose("followup", {"step": str(step), "context": ctx, "step_rules": STEP_RULES[step],
                                         "focus": _focus(db, first)})
    facts = {"company": co.get("name"), "country": co.get("country"), "sector": co.get("sector"),
             "notes_from_the_web": co.get("notes"), "contact_role": contact.get("role"),
             "emails_already_sent": [(r.get("final_text") or r.get("draft") or "") for r in prev_rows]}
    data, _ = llm.ask(db, AGENT, run_id, system, json.dumps(facts, ensure_ascii=False), schemas.DRAFT, model="sonnet")
    return data


def _queue(db, run_id, step: int, first: dict, prev: dict, body: str, contact: dict) -> dict:
    text, issues = finish(body, step)
    hits = lint.lint(text, {"recipient": contact["email"]})
    reasons = list(issues)
    if hits:
        reasons.append("lint: " + ", ".join(sorted({h["type"] for h in hits})))
    prev_mid = prev["sent_message_id"]
    chain = " ".join(x for x in (prev.get("references_hdr"), prev_mid) if x)
    row = db.insert("approval_queue", {
        "agent": AGENT, "kind": "outbound", "deal_id": first.get("deal_id"), "contact_id": contact["id"],
        "draft": text, "status": "pending", "to_email": contact["email"], "subject": subject_for(first),
        "in_reply_to_message_id": prev_mid, "references_hdr": chain, "run_id": run_id,
        "held": bool(reasons), "held_reason": "; ".join(reasons) or None, "lint": hits,
        "sequence_step": step, "sequence_parent": first["id"]})[0]
    _log(db, run_id, "draft_queued", row["id"], {"kind": "outbound", "sequence_step": step, "held": bool(reasons),
                                                 "lint": len(hits)})
    return row


# ---------------------------------------------------------------- run

def _load_steps(db) -> dict[tuple[str, int], dict]:
    """Existing step 2 / 3 drafts of any status, keyed by (first-touch id, step)."""
    out = {}
    for step in (2, 3):
        for r in db.select("approval_queue", sequence_step=step, kind="outbound", limit=5000):
            if r.get("sequence_parent"):
                out[(r["sequence_parent"], step)] = r
    return out


def run(db: DB | None = None, llm=llm_mod, now: datetime | None = None) -> dict:
    db = db or DB()
    now = now or datetime.now(timezone.utc)
    run_id = ledger.new_run_id()
    c = dict.fromkeys(("firsts", "waiting", "stale", "stopped", "created", "held", "draft_failed", "errors"), 0)
    budget_hit = False
    _log(db, run_id, RUN_ACTION)
    try:
        steps = _load_steps(db)
        firsts = [r for r in db.select("approval_queue", agent="prospector", kind="outbound", status="sent",
                                       order="created_at.asc", limit=5000) if is_first_touch(r)]
    except Exception as e:
        ledger.heartbeat(db, AGENT, "error", {"run_id": run_id, "error": type(e).__name__,
                                              "hint": "is migration 005 applied?"})
        return {"run_id": run_id, "error": type(e).__name__, **c}
    c["firsts"] = len(firsts)
    for first in firsts:
        if budget_hit:
            break
        try:
            if (first["id"], 3) in steps:
                continue                                   # sequence complete
            two = steps.get((first["id"], 2))
            if two is None:
                step, prev, prev_rows = 2, first, [first]
            elif two.get("status") == "sent":
                step, prev, prev_rows = 3, two, [first, two]
            else:
                continue                                   # step 2 pending / rejected / expired: nothing to do yet
            prev_sent = sent_at(db, prev)
            if prev_sent is None or not prev.get("sent_message_id"):
                continue
            if not is_due(prev_sent, step, now):
                c["waiting"] += 1
                continue
            if now.astimezone(PKT).date() > due_on(prev_sent, step) + timedelta(days=STALE_DAYS):
                c["stale"] += 1
                continue
            contact = (db.select("contacts", id=first["contact_id"], limit=1) or [None])[0] if first.get("contact_id") else None
            deal = (db.select("deals", id=first["deal_id"], limit=1) or [None])[0] if first.get("deal_id") else None
            why = stop_reason(db, contact, deal, sent_at(db, first))
            if why:
                c["stopped"] += 1
                if not any((a.get("detail") or {}).get("step") == step for a in
                           db.select("actions", action="followup_skipped", target_id=first["id"], limit=10)):
                    _log(db, run_id, "followup_skipped", first["id"], {"step": step, "reason": why})
                continue
            try:
                data = _compose(db, llm, run_id, step, first, prev_rows, contact, deal)
            except llm_mod.BudgetExceeded:
                budget_hit = True
                continue
            except llm_mod.LLMError as e:
                c["draft_failed"] += 1
                _log(db, run_id, "followup_draft_failed", first["id"], {"step": step, "error": str(e)[:200]})
                continue
            row = _queue(db, run_id, step, first, prev, data["body"], contact)
            steps[(first["id"], step)] = row
            c["created"] += 1
            c["held"] += 1 if row["held"] else 0
        except Exception as e:  # one bad sequence never kills the run
            c["errors"] += 1
            _log(db, run_id, "followup_error", first.get("id"), {"error": f"{type(e).__name__}: {str(e)[:200]}"})
    status = "error" if c["errors"] else ("warn" if budget_hit or c["draft_failed"] else "ok")
    detail = {"run_id": run_id, "budget_exceeded": budget_hit, **c}
    ledger.heartbeat(db, AGENT, status, detail)
    return detail


def gated_run(db: DB | None = None, llm=llm_mod, now: datetime | None = None) -> dict:
    """run() at most once per hour (the outreach job ticks every 5 minutes). Never raises: outreach must still send."""
    db = db or DB()
    now = now or datetime.now(timezone.utc)
    try:
        recent = db.select("actions", agent=AGENT, action=RUN_ACTION, at=f"gte.{(now - GATE).isoformat()}",
                           select="id", limit=1)
        if recent:
            return {"state": "gated"}
        return run(db, llm, now)
    except Exception as e:
        try:
            ledger.heartbeat(db, AGENT, "error", {"error": type(e).__name__})
        except Exception:
            pass
        return {"error": type(e).__name__}


def main() -> int:
    print(run())
    return 0


if __name__ == "__main__":
    sys.exit(main())
