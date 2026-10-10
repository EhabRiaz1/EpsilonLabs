import json
import re
from pathlib import Path

from . import config

CATALOGUE = Path(__file__).resolve().parents[2] / "catalogue.json"
ALLOWED_DOMAINS = {"epsilon-labs.co", "www.epsilon-labs.co"}

URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>\"')]+", re.I)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
IBAN_RE = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{4}[A-Z0-9 ]{7,30}\b")
ACCT_RE = re.compile(r"\b(?:iban|account\s*(?:no|number|#)?|a/c|swift|routing)\b[^\n]{0,20}?\d[\d -]{6,}", re.I)
PHONE_RE = re.compile(r"(?<![\w.])(?:\+\d[\d\s().-]{7,}\d|\(?\d{3,4}\)?[\s.-]\d{3}[\s.-]\d{3,4}\d?)(?!\w)")
MONEY_RE = re.compile(
    r"(?:(?:USD|US\$|\$|PKR|(?<![A-Za-z])(?-i:Rs)\.?|GBP|£|EUR|€)\s?(\d[\d,]*(?:\.\d+)?)\s?([kK])?)|"
    r"(?:(\d[\d,]*(?:\.\d+)?)\s?([kK])?\s?(?:USD|dollars|PKR|rupees|GBP|EUR|euros))", re.I)
PROMISE_RE = re.compile(r"\b(refunds?|guarantee[sd]?|free of charge|discounts?)\b", re.I)


def load_bands(path: Path = CATALOGUE) -> list[tuple[float, float]]:
    # Catalogue prices are "on request" today, so this is normally empty and any amount is flagged.
    bands = []
    for o in json.loads(path.read_text()).get("offers", []):
        lo, hi = o.get("price_min_usd"), o.get("price_max_usd")
        if isinstance(lo, (int, float)) and isinstance(hi, (int, float)):
            bands.append((float(lo), float(hi)))
    return bands


def _amount(m: re.Match) -> float:
    num = m.group(1) or m.group(3)
    k = m.group(2) or m.group(4)
    v = float(num.replace(",", ""))
    return v * 1000 if k else v


def lint(draft_text: str, context: dict | None = None) -> list[dict]:
    ctx = context or {}
    recipient = str(ctx.get("recipient", "")).lower()
    bands = ctx["bands"] if "bands" in ctx else load_bands()
    allowed_emails = {config.ER.lower(), recipient} - {""}
    hits: list[dict] = []

    for m in URL_RE.finditer(draft_text):
        host = re.sub(r"^(?:https?://)?([^/:?#]+).*$", r"\1", m.group(0), flags=re.I).lower()
        if host not in ALLOWED_DOMAINS:
            hits.append({"type": "url", "text": m.group(0)})
    for m in EMAIL_RE.finditer(draft_text):
        if m.group(0).lower() not in allowed_emails:
            hits.append({"type": "email", "text": m.group(0)})
    scrubbed = EMAIL_RE.sub(" ", URL_RE.sub(" ", draft_text))
    for m in IBAN_RE.finditer(scrubbed):
        if sum(c.isdigit() for c in m.group(0)) >= 6:
            hits.append({"type": "bank", "text": m.group(0).strip()})
    for m in ACCT_RE.finditer(scrubbed):
        hits.append({"type": "bank", "text": m.group(0).strip()})
    for m in PHONE_RE.finditer(scrubbed):
        hits.append({"type": "phone", "text": m.group(0).strip()})
    for m in MONEY_RE.finditer(scrubbed):
        v = _amount(m)
        if not any(lo <= v <= hi for lo, hi in bands):
            hits.append({"type": "price", "text": m.group(0).strip()})
    for m in PROMISE_RE.finditer(scrubbed):
        hits.append({"type": "promise", "text": m.group(0)})
    return hits
