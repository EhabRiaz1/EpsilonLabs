import email
import email.utils
import imaplib
import smtplib
import ssl
from datetime import date, timedelta
from email import policy
from email.message import EmailMessage, Message
from email.utils import formatdate

from . import config


OUTREACH_SERVICE = "epsilon-os-outreach"


def _creds() -> tuple[str, str]:
    return config.ER, config.secret("epsilon-os-zoho", config.ER)


def fetch_new(since_days: int = 3, creds: tuple[str, str] | None = None) -> list[dict]:
    user, pw = creds or _creds()
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
    """`fields["from"]` overrides the sender; the default is er@ (outreach mail sets it explicitly)."""
    mid = fields.get("message_id")
    if not mid:
        raise ValueError("message_id is required (pre-generate and store it before sending)")
    m = EmailMessage()
    m["From"] = fields.get("from") or config.ER
    m["To"] = fields["to"]
    m["Subject"] = fields["subject"]
    m["Date"] = formatdate(localtime=True)
    m["Message-ID"] = mid
    if fields.get("in_reply_to"):
        m["In-Reply-To"] = fields["in_reply_to"]
        refs = " ".join(x for x in [fields.get("references"), fields["in_reply_to"]] if x)
        m["References"] = " ".join(dict.fromkeys(refs.split()))
    m.set_content(fields["body"])
    if fields.get("html"):
        m.add_alternative(fields["html"], subtype="html")
    return m


def send(fields: dict, creds: tuple[str, str] | None = None) -> str:
    m = build(fields)
    user, pw = creds or _creds()
    with smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, timeout=30,
                          context=ssl.create_default_context()) as s:
        s.login(user, pw)
        s.send_message(m)
    return m["Message-ID"]


def new_message_id(domain: str = "epsilon-labs.co") -> str:
    return email.utils.make_msgid(domain=domain)


def sent_has(message_id: str, folder: str = "Sent", creds: tuple[str, str] | None = None) -> bool:
    """True if the IMAP Sent folder holds a message with this Message-ID."""
    inner = message_id.strip().strip("<>")
    if not inner or any(c in inner for c in '"\\\r\n'):
        raise ValueError("unsafe message id")
    user, pw = creds or _creds()
    imap = imaplib.IMAP4_SSL(config.IMAP_HOST, config.IMAP_PORT, timeout=30)
    try:
        imap.login(user, pw)
        typ, _ = imap.select(folder, readonly=True)
        if typ != "OK":
            raise RuntimeError(f"cannot open IMAP folder {folder!r}")
        typ, data = imap.uid("SEARCH", None, "HEADER", "Message-ID", f'"{inner}"')
        if typ != "OK":
            raise RuntimeError("IMAP search failed")
        return bool((data[0] or b"").split())
    finally:
        try:
            imap.logout()
        except Exception:
            pass


class Mailbox:
    """One mailbox with its own credentials, same surface as this module (fetch_new / send / sent_has).

    The outreach mailbox (P2) is one of these; the hosts are the same Zoho Pro hosts as er@.
    """

    def __init__(self, address: str, password: str):
        self.address, self._creds = address, (address, password)

    def fetch_new(self, since_days: int = 3) -> list[dict]:
        return fetch_new(since_days, creds=self._creds)

    def send(self, fields: dict) -> str:
        return send({**fields, "from": self.address}, creds=self._creds)

    def sent_has(self, message_id: str) -> bool:
        return sent_has(message_id, creds=self._creds)


def outreach_mailbox(address: str, secret=config.secret) -> Mailbox:
    """Mailbox for the outreach address. Raises config.SecretError when the keychain item is missing."""
    return Mailbox(address, secret(OUTREACH_SERVICE, address))
