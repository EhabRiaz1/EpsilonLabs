"""Shared plumbing for the tender feeds: the normalised Opp, polite HTTP, text and date helpers.

No feed module uses a model. They fetch from official public APIs / open data and return `Opp`s; relevance,
value and deadline filtering live in `core.feeds.filters` and eligibility in `core.feeds.eligibility`.
"""
import html
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone

import httpx

# Standard bot-style UA. Verified 2026-10-11: AusTender and UNGM answer 403 to a bare product UA and to a UA with
# extra prose, and 200 to this form (the same shape Googlebot uses). It still names us and our site.
USER_AGENT = "Mozilla/5.0 (compatible; EpsilonOS/1.0; +https://epsilon-labs.co)"
TIMEOUT = httpx.Timeout(40.0, connect=10.0)
RETRIES = 3
PAUSE = 1.0           # seconds between consecutive requests to the same host
SUMMARY_MAX = 4000

_sleep = time.sleep   # tests replace this so retries and pauses cost nothing


@dataclass
class Opp:
    source: str                      # ted | uk_fts | uk_cf | canadabuys | austender | ungm | samgov
    source_id: str
    title: str
    url: str = ""
    buyer: str = ""
    country: str = ""                # ISO 3166 alpha-2 where known, else the name the feed gave
    cpv_or_naics: list[str] = field(default_factory=list)
    published_at: datetime | None = None
    deadline_at: datetime | None = None
    value_min: float | None = None
    value_max: float | None = None
    currency: str = ""
    summary: str = ""
    raw: dict = field(default_factory=dict)   # small, JSON-safe subset of what the feed said

    def row(self) -> dict:
        """The opportunities-table columns this feed is responsible for (fit/status are set by the agent)."""
        d = asdict(self)
        for k in ("published_at", "deadline_at"):
            d[k] = d[k].isoformat() if d[k] else None
        d["summary"] = (d["summary"] or "")[:SUMMARY_MAX]
        d["currency"] = d["currency"] or None
        return d


class FeedError(RuntimeError):
    pass


class Disabled(FeedError):
    """A feed that ships switched off because it needs a login, is behind an anti-bot check or is unreachable."""


def disabled(source: str, reason: str):
    def fetch(since, client=None):
        raise Disabled(f"{source}: disabled ({reason[:120]})")
    return fetch


def client() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": USER_AGENT, "Accept": "application/json, text/*;q=0.8, */*;q=0.5"},
                        timeout=TIMEOUT, follow_redirects=True)


def request(c: httpx.Client, method: str, url: str, *, retries: int = RETRIES, **kw) -> httpx.Response:
    """One HTTP call with retries on network errors, 429 and 5xx. Raises FeedError (no URL query: it may carry a key)."""
    last = ""
    for attempt in range(retries):
        try:
            r = c.request(method, url, **kw)
        except (httpx.TransportError, httpx.TimeoutException) as e:
            last = type(e).__name__
        else:
            if r.status_code < 400:
                return r
            last = f"HTTP {r.status_code}"
            if r.status_code < 500 and r.status_code != 429:
                break
        if attempt + 1 < retries:
            _sleep(2 ** attempt)
    host = httpx.URL(url).host
    raise FeedError(f"{method} {host}: {last}")


def pause() -> None:
    _sleep(PAUSE)


# ---------------------------------------------------------------- text

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"[ \t\r\f\v]+")


def clean_text(s, limit: int = SUMMARY_MAX) -> str:
    t = html.unescape(_TAG.sub(" ", str(s or "")))
    t = _WS.sub(" ", t)
    t = re.sub(r"\s*\n\s*", "\n", t).strip()
    return t[:limit]


def pick_lang(d, prefer=("eng", "en")) -> tuple[str, bool]:
    """TED-style {lang: text|[text]} -> (text, is_english). Falls back to the first language present."""
    if isinstance(d, str):
        return d, True
    if isinstance(d, list):
        d = d[0] if d else ""
        return (d, True) if isinstance(d, str) else pick_lang(d, prefer)
    if not isinstance(d, dict) or not d:
        return "", True
    for k in prefer:
        if k in d and d[k]:
            v = d[k]
            return (v[0] if isinstance(v, list) and v else str(v)), True
    k = next(iter(d))
    v = d[k]
    return (v[0] if isinstance(v, list) and v else str(v)), False


# ---------------------------------------------------------------- dates

_DATE_ONLY = re.compile(r"^(\d{4}-\d\d-\d\d)(Z|[+-]\d\d:\d\d)?$")


def parse_dt(v) -> datetime | None:
    """ISO-ish string -> aware UTC datetime. Date-only values become noon UTC (a deadline day is a day, not midnight)."""
    if not v:
        return None
    s = str(v).strip()
    m = _DATE_ONLY.match(s)
    if m:
        return datetime.fromisoformat(m.group(1) + "T12:00:00+00:00")
    s = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def as_datetime(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


def num(v) -> float | None:
    try:
        x = float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return x if x > 0 else None


# ---------------------------------------------------------------- countries

ISO3 = {"AUT": "AT", "BEL": "BE", "BGR": "BG", "HRV": "HR", "CYP": "CY", "CZE": "CZ", "DNK": "DK", "EST": "EE",
        "FIN": "FI", "FRA": "FR", "DEU": "DE", "GRC": "GR", "HUN": "HU", "IRL": "IE", "ITA": "IT", "LVA": "LV",
        "LTU": "LT", "LUX": "LU", "MLT": "MT", "NLD": "NL", "POL": "PL", "PRT": "PT", "ROU": "RO", "SVK": "SK",
        "SVN": "SI", "ESP": "ES", "SWE": "SE", "ISL": "IS", "LIE": "LI", "NOR": "NO", "CHE": "CH", "GBR": "GB",
        "USA": "US", "CAN": "CA", "AUS": "AU", "NZL": "NZ", "TUR": "TR", "UKR": "UA", "SRB": "RS", "ALB": "AL",
        "MKD": "MK", "MNE": "ME", "BIH": "BA", "MDA": "MD", "XXX": "", "ENG": "GB", "SCT": "GB", "WLS": "GB",
        "NIR": "GB"}
NAME = {"united kingdom": "GB", "england": "GB", "scotland": "GB", "wales": "GB", "northern ireland": "GB",
        "great britain": "GB", "united states": "US", "canada": "CA", "australia": "AU", "new zealand": "NZ",
        "ireland": "IE", "germany": "DE", "france": "FR", "netherlands": "NL", "belgium": "BE", "italy": "IT",
        "spain": "ES", "sweden": "SE", "denmark": "DK", "finland": "FI", "norway": "NO", "poland": "PL",
        "switzerland": "CH", "austria": "AT", "portugal": "PT", "greece": "GR", "czechia": "CZ", "romania": "RO",
        "kenya": "KE", "ukraine": "UA", "jordan": "JO", "lebanon": "LB", "iraq": "IQ", "egypt": "EG",
        "nigeria": "NG", "ethiopia": "ET", "south africa": "ZA", "india": "IN", "pakistan": "PK",
        "bangladesh": "BD", "nepal": "NP", "afghanistan": "AF", "turkey": "TR", "türkiye": "TR", "uganda": "UG",
        "tanzania": "TZ", "ghana": "GH", "senegal": "SN", "thailand": "TH", "philippines": "PH", "indonesia": "ID",
        "viet nam": "VN", "vietnam": "VN", "cambodia": "KH", "myanmar": "MM", "sri lanka": "LK", "colombia": "CO",
        "brazil": "BR", "mexico": "MX", "peru": "PE", "haiti": "HT", "switzerland ": "CH", "luxembourg": "LU",
        "croatia": "HR", "bulgaria": "BG", "hungary": "HU", "slovakia": "SK", "slovenia": "SI", "estonia": "EE",
        "latvia": "LV", "lithuania": "LT", "cyprus": "CY", "malta": "MT", "iceland": "IS", "japan": "JP",
        "singapore": "SG", "united arab emirates": "AE", "saudi arabia": "SA", "qatar": "QA", "israel": "IL"}


def country_code(v) -> str:
    s = str(v or "").strip()
    if not s:
        return ""
    if s.upper() in ISO3:
        return ISO3[s.upper()]
    if re.fullmatch(r"[A-Za-z]{2}", s):
        return s.upper()
    return NAME.get(s.lower(), s)


# ---------------------------------------------------------------- money

# Approximate USD per unit, used only to compare a tender's stated value with the founder's band.
# A drifted rate moves a borderline tender by a few percent; unknown currencies are treated as "value unknown".
FX_USD = {"USD": 1.0, "EUR": 1.08, "GBP": 1.27, "CAD": 0.73, "AUD": 0.65, "NZD": 0.60, "CHF": 1.12, "SEK": 0.095,
          "NOK": 0.092, "DKK": 0.145, "PLN": 0.25, "CZK": 0.043, "HUF": 0.0027, "RON": 0.22, "BGN": 0.55,
          "ISK": 0.0072, "JPY": 0.0067, "SGD": 0.75, "AED": 0.272, "SAR": 0.267, "INR": 0.012, "TRY": 0.024}


def to_usd(amount: float | None, currency: str | None) -> float | None:
    if amount is None:
        return None
    rate = FX_USD.get((currency or "").upper())
    return amount * rate if rate else None
