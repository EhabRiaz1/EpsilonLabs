"""Inbox agent: concierge + reply triage in one pipeline (D1).

Python does every action. The model only classifies and drafts (tool-less, via core.llm.ask).
Code-guard decisions (auto-reply, bounce, opt-out, suppression, own address) are never delegated
to the model. Nothing here sends mail: drafts go to approval_queue for the outbox agent.
"""
import hashlib
import re
import sys
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr
from pathlib import Path

from agents import followups
from core import config, guard, ledger, lint, llm, mail, settings
from core.db import DB, DBError
from prompts import loader, schemas

AGENT = "inbox"
ROOT = Path(__file__).resolve().parents[2]
ACK_TEMPLATE = ROOT / "docs" / "outreach" / "ack-template.md"
MODES = ("all", "concierge", "triage")
MAX_BODY = 6000
OPEN_STAGES = "in.(lead,conversation,scoping_call,quote_out)"
WEDGE_MAP = {"W1": "fuel_retail", "W2": "industrial_monitoring", "W3": "protocol_decode", "OUT": "other"}
FREEMAIL = {"gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
            "icloud.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "yandex.com", "msn.com"}
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z'\-]{0,29}$")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
NON_RECIPIENT_RE = re.compile(r"^(mailer-daemon|postmaster)@", re.I)

OPTOUT_CONFIRM = ("Hi {name},\n\nUnderstood. You are removed from our list and we will not contact you "
                  "again.\n\nEpsilon Labs, Lahore\n")


# ---------------------------------------------------------------- helpers

def _now() -> datetime:
    return datetime.now(timezone.utc)


def first_name(display: str) -> str:
    tok = (display or "").strip().split(" ")[0] if (display or "").strip() else ""
    return tok if NAME_RE.match(tok) and tok.lower() not in ("unknown", "support", "admin") else "there"


def load_ack_body(path: Path = ACK_TEMPLATE) -> str:
    """Body of docs/outreach/ack-template.md (text after the Subject line), name placeholder intact."""
    text = path.read_text().split("\n---\n", 1)[1]
    text = re.sub(r"\n\*\(~\d+ words\)\*\s*$", "\n", text.strip() + "\n")
    lines = text.split("\n")
    if not lines[0].lower().startswith("subject:"):
        raise ValueError("ack template: expected a Subject line first")
    return "\n".join(lines[1:]).strip() + "\n"


def render_ack(name: str, path: Path = ACK_TEMPLATE) -> str:
    body = load_ack_body(path)
    out = re.sub(r'\{\{first_name_or_"there"\}\}', first_name(name), body)
    if "{{" in out:
        raise ValueError("ack template has an unfilled placeholder")
    return out


def _one_line(s: str, limit: int = 200) -> str:
    return re.sub(r"\s+", " ", s or "").strip()[:limit]


def normalise(m: dict) -> dict:
    msg = m["msg"]
    name, addr = parseaddr(str(msg.get("From", "")))
    body = m.get("text") or ""
    mid = m.get("message_id") or ""
    if not mid:
        digest = hashlib.sha1((str(sorted(m.get("headers", {}).items())) + body).encode()).hexdigest()[:24]
        mid = f"<noid-{digest}@local>"
    return {
        "message_id": mid, "sender": addr.lower(), "name": name, "subject": _one_line(str(msg.get("Subject", ""))),
        "body": body, "msg": msg,
        "in_reply_to": _one_line(str(msg.get("In-Reply-To", "")), 500),
        "references": _one_line(str(msg.get("References", "")), 2000),
    }


def reply_subject(subject: str) -> str:
    s = subject or "your message"
    return s if s.lower().startswith("re:") else f"Re: {s}"


def untrusted_text(n: dict) -> str:
    return f"From: {n['name']} <{n['sender']}>\nSubject: {n['subject']}\n\n{n['body'][:MAX_BODY]}"


def classify(ask, db, run_id: str, n: dict, is_reply: bool = False) -> dict:
    system = loader.compose("classify", {
        "thread": "this is a reply on a thread we started" if is_reply else "this is a new thread"})
    data, _ = ask(db, AGENT, run_id, system, untrusted_text(n), schemas.CLASSIFY, model="haiku")
    return data


def draft_reply(ask, db, run_id: str, n: dict, cls: dict, is_reply: bool = False) -> dict:
    ctx = (f"wedge={cls.get('wedge', 'NA')}; flags={','.join(cls.get('flags', [])) or 'none'}; "
           f"classification={cls.get('label')}; " + ("reply on an existing thread" if is_reply else "first contact"))
    system = loader.compose("draft_reply", {"context": ctx})
    data, _ = ask(db, AGENT, run_id, system, untrusted_text(n), schemas.DRAFT, model="sonnet")
    return data


def _log(S, action: str, **kw) -> None:
    try:
        ledger.action(S.db, AGENT, S.run_id, action, **kw)
    except Exception:
        pass  # logging must never kill the run


# ---------------------------------------------------------------- state

class State:
    def __init__(self, db, mail_mod, ask, run_id: str, mode: str):
        self.db, self.mail, self.ask, self.run_id, self.mode = db, mail_mod, ask, run_id, mode
        self.budget_hit = False
        self.outreach = False   # True while processing the outreach mailbox (always triage, P2/P5)
        self.own: tuple[str, ...] = ()  # our own addresses besides er@ (the outreach address)
        self.c = dict.fromkeys(("outreach_fetched", "outreach_fetch_failed", "fetched", "processed", "duplicates", "skipped_mode", "unprocessed", "errors",
                                "drafts", "held", "opt_outs", "bounces", "auto_replies", "inquiries",
                                "injections", "draft_failed", "classify_failed"), 0)


# ---------------------------------------------------------------- data access

def _touch(S, n, type_, direction="inbound", classifier=None, deal_id=None, contact_id=None) -> dict:
    return S.db.insert("touches", {
        "type": type_, "direction": direction, "channel": "email", "message_id": n["message_id"],
        "subject": n["subject"], "body_excerpt": n["body"][:1000], "classifier": classifier,
        "deal_id": deal_id, "contact_id": contact_id,
    })[0]


def _find_contact(S, addr: str) -> dict | None:
    rows = S.db.select("contacts", email=addr, limit=1)
    return rows[0] if rows else None


def _upsert_contact(S, n, company_id=None) -> dict:
    c = _find_contact(S, n["sender"])
    if c:
        return c
    return S.db.insert("contacts", {"company_id": company_id, "full_name": n["name"] or None,
                                    "email": n["sender"], "legal_basis": "inbound"})[0]


def _upsert_company(S, n) -> dict:
    domain = n["sender"].rsplit("@", 1)[-1]
    if domain not in FREEMAIL:
        rows = S.db.select("companies", domain=domain, limit=1)
        if rows:
            return rows[0]
        return S.db.insert("companies", {"name": domain, "domain": domain})[0]
    return S.db.insert("companies", {"name": n["name"] or n["sender"]})[0]


def _stop_sequences(S, reason: str, contact_id=None, deal_id=None, email=None) -> None:
    """A reply, opt-out or bounce ends any follow-up sequence for that contact. Best effort: outreach re-checks
    right before it sends, so a failure here only costs a log line."""
    try:
        followups.expire_sequence(S.db, AGENT, S.run_id, contact_id=contact_id, deal_id=deal_id, email=email,
                                  reason=reason)
    except Exception as e:
        _log(S, "sequence_stop_error", detail={"error": type(e).__name__, "reason": reason})


def _suppress(S, addr: str, reason: str, touch_id: str | None) -> None:
    if S.db.select("suppression_list", email=addr, limit=1):
        return
    S.db.insert("suppression_list", {"email": addr, "reason": reason, "forever": True,
                                     "source_touch_id": touch_id})


def _sent_thread(S, n) -> dict | None:
    """The sent approval_queue row this mail replies to (In-Reply-To / References), if any."""
    ids = list(dict.fromkeys(re.findall(r"<[^<>\s,\"]+>", f"{n['in_reply_to']} {n['references']}")))
    if not ids:
        return None
    quoted = ",".join(f'"{i}"' for i in ids[:20])
    rows = S.db.select("approval_queue", sent_message_id=f"in.({quoted})", status="sent", limit=1)
    return rows[0] if rows else None


def _acked_recently(S, addr: str) -> bool:
    since = (_now() - timedelta(hours=24)).isoformat()
    rows = S.db.select("approval_queue", to_email=addr, kind="ack", created_at=f"gte.{since}",
                       status="in.(pending,approved,edited_approved,sending,sent)", limit=1)
    return bool(rows)


def _queue_draft(S, kind: str, n: dict, body: str, touch_id, deal_id, contact_id,
                 held: bool = False, held_reason: str | None = None) -> dict:
    hits = lint.lint(body, {"recipient": n["sender"]})
    reasons = [held_reason] if held_reason else []
    if hits:
        held = True
        reasons.append("lint: " + ", ".join(sorted({h["type"] for h in hits})))
    row = S.db.insert("approval_queue", {
        "agent": AGENT, "kind": kind, "deal_id": deal_id, "contact_id": contact_id,
        "in_reply_to_touch_id": touch_id, "draft": body, "status": "pending",
        "to_email": n["sender"], "subject": reply_subject(n["subject"]),
        "in_reply_to_message_id": n["message_id"], "references_hdr": n["references"] or None,
        "run_id": S.run_id, "held": held, "held_reason": "; ".join(reasons) or None, "lint": hits,
    })[0]
    S.c["drafts"] += 1
    S.c["held"] += 1 if held else 0
    _log(S, "draft_queued", target_table="approval_queue", target_id=row["id"],
         detail={"kind": kind, "held": held, "lint": len(hits)})
    return row


# ---------------------------------------------------------------- outcomes

def _hard_bounce_recipient(n, own: tuple[str, ...] = ()) -> str | None:
    msg = n["msg"]
    failed = str(msg.get("X-Failed-Recipients", "")).strip()
    cands = EMAIL_RE.findall(failed)
    if not cands:
        m = re.search(r"(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s<>]+@[^\s<>]+)", n["body"], re.I)
        cands = [m.group(1)] if m else []
    if not cands:
        cands = EMAIL_RE.findall(n["body"])
    for c in cands:
        c = c.lower().rstrip(".")
        if c != config.ER.lower() and c not in own and not NON_RECIPIENT_RE.match(c) and c != n["sender"]:
            return c
    return None


def _bounce_touch(S, n, classifier) -> dict:
    """Log a bounce, linked to the contact whose address bounced when it can be worked out, and end its sequence.
    The recipient is read from the bounce report (never from the model); an unknown one stays unlinked."""
    rcpt = _hard_bounce_recipient(n, S.own)
    contact = _find_contact(S, rcpt) if rcpt else None
    t = _touch(S, n, "bounce", classifier=classifier, contact_id=contact["id"] if contact else None)
    if contact:
        _stop_sequences(S, "bounce", contact_id=contact["id"], email=contact["email"])
    return t


def _opt_out(S, n, cls, via: str) -> None:
    contact = _upsert_contact(S, n)
    S.db.update("contacts", {"opted_out": True}, id=contact["id"])
    touch = _touch(S, n, "opt_out", classifier={**(cls or {}), "via": via}, contact_id=contact["id"])
    _suppress(S, n["sender"], "opt_out", touch["id"])
    S.db.update("approval_queue", {"status": "rejected", "decided_at": _now().isoformat()},
                to_email=n["sender"], status="pending")
    already = S.db.select("approval_queue", to_email=n["sender"], kind="optout_confirm",
                          status="in.(pending,approved,edited_approved,sending,sent)", limit=1)
    if not already:
        _queue_draft(S, "optout_confirm", n, OPTOUT_CONFIRM.format(name=first_name(n["name"])),
                     touch["id"], None, contact["id"])
    _stop_sequences(S, "opt_out", contact_id=contact["id"], email=n["sender"])
    S.c["opt_outs"] += 1
    _log(S, "opt_out", target_table="touches", target_id=touch["id"], detail={"via": via})


def _crm(S, n, wedge: str, thread: dict | None) -> tuple[str | None, str]:
    """Upsert company / contact / deal. Returns (deal_id, contact_id)."""
    contact = _find_contact(S, n["sender"])
    if contact and contact.get("company_id"):
        company_id = contact["company_id"]
    else:
        company_id = _upsert_company(S, n)["id"]
    if not contact:
        contact = _upsert_contact(S, n, company_id)
    deal_id = (thread or {}).get("deal_id")
    if not deal_id:
        rows = S.db.select("deals", company_id=company_id, stage=OPEN_STAGES, order="created_at.desc", limit=1)
        if rows:
            deal_id = rows[0]["id"]
    if not deal_id:
        deal_id = S.db.insert("deals", {
            "company_id": company_id, "primary_contact_id": contact["id"],
            "title": f"Inbound: {n['subject'][:80] or n['sender']}", "stage": "lead",
            "wedge": WEDGE_MAP.get(wedge), "source_channel": "inbound"})[0]["id"]
    return deal_id, contact["id"]


def _inquiry(S, n, cls, thread, injection: bool) -> None:
    triage = thread is not None or S.outreach
    deal_id, contact_id = _crm(S, n, cls["wedge"], thread)
    classifier = {**cls, "injection_suspected": injection, "triage": triage}
    touch = _touch(S, n, "human_reply", classifier=classifier, deal_id=deal_id, contact_id=contact_id)
    _stop_sequences(S, "human_reply", contact_id=contact_id, deal_id=deal_id, email=n["sender"])
    S.c["inquiries"] += 1
    held, why = (True, "injection_suspected") if injection else (False, None)
    if triage and cls["stage_proposal"] != "none":
        _log(S, "stage_proposal", target_table="deals", target_id=deal_id,
             detail={"proposed_stage": cls["stage_proposal"], "touch_id": touch["id"], "applied": False})
    if not triage:
        _queue_draft(S, "ack", n, render_ack(n["name"]), touch["id"], deal_id, contact_id, held, why)
    if S.budget_hit:
        S.c["draft_failed"] += 1
        _log(S, "draft_failed", target_table="touches", target_id=touch["id"], detail={"error": "budget"})
        return
    try:
        d = draft_reply(S.ask, S.db, S.run_id, n, cls, triage)
    except llm.BudgetExceeded:
        S.budget_hit = True
        S.c["draft_failed"] += 1
        _log(S, "draft_failed", target_table="touches", target_id=touch["id"], detail={"error": "budget"})
        return
    except llm.LLMError as e:
        S.c["draft_failed"] += 1
        _log(S, "draft_failed", target_table="touches", target_id=touch["id"], detail={"error": str(e)[:200]})
        return
    if d.get("notes"):
        _log(S, "draft_notes", target_table="touches", target_id=touch["id"], detail={"notes": d["notes"][:400]})
    _queue_draft(S, "outbound" if S.outreach else "reply", n, d["body"], touch["id"], deal_id, contact_id, held, why)


def _handle_label(S, n, cls, thread) -> None:
    label = cls["label"]
    if label == "opt_out":
        _opt_out(S, n, cls, "model")
    elif label in ("auto_reply", "bounce"):
        if label == "bounce":
            _bounce_touch(S, n, cls)
        else:
            _touch(S, n, label, classifier=cls)
        S.c["auto_replies" if label == "auto_reply" else "bounces"] += 1
    elif label == "injection_suspected":
        S.c["injections"] += 1
        if cls["wedge"] != "NA":  # a genuine inquiry sits inside: keep the lead, hold every draft
            _inquiry(S, n, cls, thread, injection=True)
        else:
            contact = _find_contact(S, n["sender"])
            t = _touch(S, n, "human_reply", classifier={**cls, "injection_suspected": True},
                       contact_id=contact["id"] if contact else None)
            if contact:
                _stop_sequences(S, "human_reply", contact_id=contact["id"], email=n["sender"])
            _log(S, "injection_flagged", target_table="touches", target_id=t["id"], detail={"reason": cls["reason"][:200]})
    else:
        _inquiry(S, n, cls, thread, injection=False)


# ---------------------------------------------------------------- per message

def _process(S: State, m: dict) -> None:
    n = normalise(m)
    if S.db.select("touches", message_id=n["message_id"], select="id", limit=1):
        S.c["duplicates"] += 1
        return
    thread = _sent_thread(S, n)
    if not S.outreach and ((S.mode == "concierge" and thread) or (S.mode == "triage" and not thread)):
        S.c["skipped_mode"] += 1
        return

    d = guard.check(
        n["msg"],
        suppressed=lambda e: bool(S.db.rpc("is_suppressed", {"addr": e})),
        already_acked=lambda _m: thread is None and not S.outreach and _acked_recently(S, n["sender"]),
        own=S.own,
    )
    if S.outreach and d.action == "proceed" and thread is None and not _find_contact(S, n["sender"]):
        # Outreach mailbox: guard outcomes (bounce, opt-out, auto-reply, suppression) apply to everything, but a
        # real message is only worked when it threads to one of our sends or comes from a contact we know.
        S.c["skipped_mode"] += 1
        return
    g = {"guard": d.action, "rule": d.rule, "reason": d.reason}
    if d.action == "opt_out":
        _opt_out(S, n, g, "guard")
    elif d.action == "auto_reply":
        _touch(S, n, "auto_reply", classifier=g)
        S.c["auto_replies"] += 1
    elif d.action == "bounce":
        t = _bounce_touch(S, n, {**g, "hard": d.hard_bounce})
        S.c["bounces"] += 1
        if d.hard_bounce:
            rcpt = _hard_bounce_recipient(n, S.own)
            if rcpt:
                _suppress(S, rcpt, "hard_bounce", t["id"])
                _log(S, "hard_bounce_suppressed", target_table="touches", target_id=t["id"], detail={"recipient": rcpt})
    elif d.action == "ignore":
        _touch(S, n, "human_reply", direction="internal", classifier=g)
    elif d.action in ("suppressed", "already_acked"):
        contact = _find_contact(S, n["sender"])
        _touch(S, n, "human_reply", classifier=g, contact_id=contact["id"] if contact else None)
        if contact:
            _stop_sequences(S, "human_reply", contact_id=contact["id"], email=n["sender"])
    else:
        if S.budget_hit:
            S.c["unprocessed"] += 1  # no touch written: picked up by a later run
            return
        try:
            cls = classify(S.ask, S.db, S.run_id, n, is_reply=thread is not None)
        except llm.BudgetExceeded:
            S.budget_hit = True
            S.c["unprocessed"] += 1
            return
        except llm.LLMError as e:
            S.c["classify_failed"] += 1
            contact = _find_contact(S, n["sender"])
            t = _touch(S, n, "human_reply", classifier={"label": "classify_failed", "needs_human": True},
                       contact_id=contact["id"] if contact else None)
            if contact:
                _stop_sequences(S, "human_reply", contact_id=contact["id"], email=n["sender"])
            _log(S, "classify_failed", target_table="touches", target_id=t["id"], detail={"error": str(e)[:200]})
            return
        _handle_label(S, n, cls, thread)
    S.c["processed"] += 1


# ---------------------------------------------------------------- run

def _outreach_box(db):
    """(mailbox, address) for the outreach mailbox, or (None, address) when it is not configured."""
    addr = settings.outreach_address(db)
    if not addr:
        return None, ""
    try:
        return mail.outreach_mailbox(addr), addr
    except config.SecretError:
        return None, addr


def _loop(S: State, messages: list[dict]) -> None:
    for m in messages:
        try:
            _process(S, m)
        except Exception as e:  # one bad message must not kill the run
            S.c["errors"] += 1
            _log(S, "message_error", detail={"message_id": str(m.get("message_id", ""))[:200],
                                              "error": f"{type(e).__name__}: {str(e)[:200]}"})


def run(db: DB | None = None, mail_mod=mail, ask=llm.ask, mode: str = "all", fetch_days: int = 3,
        outreach_mail="auto") -> dict:
    """`outreach_mail`: "auto" reads the outreach mailbox when settings + keychain have it; None disables;
    any object with fetch_new() is used as that mailbox (tests)."""
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    db = db or DB()
    run_id = ledger.new_run_id()
    S = State(db, mail_mod, ask, run_id, mode)
    ledger.heartbeat(db, AGENT, "ok", {"run_id": run_id, "phase": "start", "mode": mode})
    if outreach_mail == "auto":
        box, addr = _outreach_box(db)
    else:
        box, addr = outreach_mail, settings.outreach_address(db)
    S.own = (addr,) if addr else ()
    try:
        messages = mail_mod.fetch_new(fetch_days)
    except Exception as e:
        ledger.heartbeat(db, AGENT, "error", {"run_id": run_id, "error": f"fetch failed: {type(e).__name__}"})
        return {"run_id": run_id, "error": type(e).__name__, **S.c}
    S.c["fetched"] = len(messages)
    _loop(S, messages)
    if box is not None:
        try:
            more = box.fetch_new(fetch_days)
        except Exception as e:  # the main inbox already ran; a broken outreach mailbox only warns
            S.c["outreach_fetch_failed"] += 1
            _log(S, "outreach_fetch_failed", detail={"error": type(e).__name__})
            more = []
        S.c["outreach_fetched"] = len(more)
        S.outreach = True
        _loop(S, more)
        S.outreach = False
    status = "warn" if (S.budget_hit or S.c["errors"] or S.c["draft_failed"] or S.c["classify_failed"]
                        or S.c["outreach_fetch_failed"]) else "ok"
    detail = {"run_id": run_id, "mode": mode, "budget_exceeded": S.budget_hit, **S.c}
    ledger.heartbeat(db, AGENT, status, detail)
    return detail


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    result = run(mode=mode)
    print({k: v for k, v in result.items() if k != "error" or v})
    return 1 if result.get("error") else 0


if __name__ == "__main__":
    sys.exit(main())
