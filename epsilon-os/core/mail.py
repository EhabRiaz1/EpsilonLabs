import email
import imaplib
import smtplib
import ssl
from datetime import date, timedelta
from email import policy
from email.message import EmailMessage, Message
from email.utils import formatdate

from . import config


def _creds() -> tuple[str, str]:
    return config.ER, config.secret("epsilon-os-zoho", config.ER)


def fetch_new(since_days: int = 3) -> list[dict]:
    user, pw = _creds()
    since = (date.today() - timedelta(days=since_days)).strftime("%d-%b-%Y")
    out = []
    imap = imaplib.IMAP4_SSL(config.IMAP_HOST, config.IMAP_PORT, timeout=30)
    try:
        imap.login(user, pw)
        imap.select("INBOX", readonly=True)
        typ, data = imap.uid("SEARCH", None, "SINCE", since)
        for uid in (data[0] or b"").split():
            typ, parts = imap.uid("FETCH", uid, "(BODY.PEEK[])")
            raw = next((p[1] for p in parts if isinstance(p, tuple)), None)
            if raw is None:
                continue
            out.append(parse(raw, uid.decode()))
    finally:
        try:
            imap.logout()
        except Exception:
            pass
    return out


def parse(raw: bytes, uid: str | None = None) -> dict:
    msg = email.message_from_bytes(raw, policy=policy.default)
    body = msg.get_body(preferencelist=("plain", "html"))
    text = body.get_content() if body is not None else ""
    return {"uid": uid, "message_id": str(msg.get("Message-ID", "")).strip(),
            "headers": {k: str(v) for k, v in msg.items()}, "text": text, "msg": msg}


def build(fields: dict) -> EmailMessage:
    mid = fields.get("message_id")
    if not mid:
        raise ValueError("message_id is required (pre-generate and store it before sending)")
    m = EmailMessage()
    m["From"] = config.ER
    m["To"] = fields["to"]
    m["Subject"] = fields["subject"]
    m["Date"] = formatdate(localtime=True)
    m["Message-ID"] = mid
    if fields.get("in_reply_to"):
        m["In-Reply-To"] = fields["in_reply_to"]
        refs = " ".join(x for x in [fields.get("references"), fields["in_reply_to"]] if x)
        m["References"] = " ".join(dict.fromkeys(refs.split()))
    m.set_content(fields["body"])
    return m


def send(fields: dict) -> str:
    m = build(fields)
    user, pw = _creds()
    with smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, timeout=30,
                          context=ssl.create_default_context()) as s:
        s.login(user, pw)
        s.send_message(m)
    return m["Message-ID"]
