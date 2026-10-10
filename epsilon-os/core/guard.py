import re
from dataclasses import dataclass
from email.message import Message
from email.utils import parseaddr
from typing import Callable

from . import config

OPT_OUT_RE = re.compile(
    r"\bunsubscribe\b|\bremove\s+me\b|\bstop\s+(emailing|e-mailing|contacting|sending)\b|"
    r"\bopt[\s-]?out\b|\btake\s+me\s+off\b", re.I)
OOO_RE = re.compile(
    r"out\s+of\s+(the\s+)?office|automatic\s+reply|auto[\s-]?reply|autoreply|on\s+vacation|"
    r"on\s+annual\s+leave|away\s+from\s+(my\s+)?(desk|email)|i\s+am\s+currently\s+away|"
    r"will\s+(be\s+)?(back|return)\s+on|limited\s+access\s+to\s+(my\s+)?email", re.I)
BOUNCE_SUBJECT_RE = re.compile(
    r"undeliverable|delivery\s+status\s+notification|mail\s+delivery\s+(failed|failure)|"
    r"returned\s+mail|delivery\s+has\s+failed", re.I)
BOUNCE_SENDER_RE = re.compile(r"^(mailer-daemon|postmaster)(@|$)", re.I)
HARD_RE = re.compile(r"\b5\.\d\.\d\b|\b55\d\b|user\s+unknown|no\s+such\s+user|does\s+not\s+exist|"
                     r"mailbox\s+unavailable|address\s+rejected", re.I)
SOFT_RE = re.compile(r"\b4\.\d\.\d\b|\b4[25]\d\b|mailbox\s+full|over\s+quota|try\s+again\s+later|"
                     r"temporar", re.I)


@dataclass(frozen=True)
class Decision:
    action: str  # proceed | auto_reply | bounce | ignore | opt_out | suppressed | already_acked
    rule: int | None = None
    reason: str = ""
    hard_bounce: bool | None = None


def body_text(msg: Message) -> str:
    parts = []
    for p in msg.walk():
        if p.get_content_maintype() == "text":
            try:
                parts.append(p.get_content())
            except (LookupError, UnicodeDecodeError):
                parts.append(str(p.get_payload(decode=True) or b"", "utf-8", "replace"))
    return "\n".join(parts)


def _sender(msg: Message) -> str:
    return parseaddr(str(msg.get("From", "")))[1].lower()


def _is_bounce(msg: Message, sender: str, subject: str) -> bool:
    if BOUNCE_SENDER_RE.match(sender):
        return True
    if msg.get_content_type() == "multipart/report" and \
            str(msg.get_param("report-type") or "").lower() == "delivery-status":
        return True
    if "Return-Path" in msg and str(msg["Return-Path"]).strip() == "<>":
        return True
    return bool(BOUNCE_SUBJECT_RE.search(subject))


def check(msg: Message, suppressed: Callable[[str], bool] = lambda e: False,
          already_acked: Callable[[Message], bool] = lambda m: False) -> Decision:
    sender = _sender(msg)
    subject = str(msg.get("Subject", ""))
    body = body_text(msg)

    auto = msg.get("Auto-Submitted")
    if auto is not None and str(auto).strip().lower() != "no":
        return Decision("auto_reply", 1, "Auto-Submitted header")
    if str(msg.get("Precedence", "")).strip().lower() in ("bulk", "list", "junk"):
        return Decision("auto_reply", 2, "Precedence header")
    if _is_bounce(msg, sender, subject):
        hard = True if HARD_RE.search(body) else (False if SOFT_RE.search(body) else None)
        return Decision("bounce", 3, "bounce pattern", hard_bounce=hard)
    if sender == config.ER.lower():
        return Decision("ignore", 5, "own address")
    if suppressed(sender):
        return Decision("suppressed", 6, "sender on suppression list")
    # Opt-out is binding and outranks content-based rules, including any injection suspicion.
    if OPT_OUT_RE.search(subject) or OPT_OUT_RE.search(body):
        return Decision("opt_out", None, "opt-out wording")
    if OOO_RE.search(subject) or OOO_RE.search(body[:2000]):
        return Decision("auto_reply", 4, "out-of-office text")
    if already_acked(msg):
        return Decision("already_acked", 5, "thread acked within 24h")
    return Decision("proceed")
