"""EU TED (Tenders Electronic Daily) via the anonymous Search API v3.

    POST https://api.ted.europa.eu/v3/notices/search      (no key; verified live 2026-10-11)
    body {"query": <expert query>, "fields": [...], "limit": 100, "page": n, "scope": "ACTIVE"}

Expert-query facts checked against the live API:
  * `publication-date>=YYYYMMDD`, `deadline-receipt-tender-date-lot>=YYYYMMDD` and
    `classification-cpv=72*` (prefix wildcard) work; `(A OR B)` groups work.
  * Full text is `FT~term` or `FT~"two words"`; `FT~(a OR b)` does NOT work but `(FT~a OR FT~b)` does.
  * Text fields come back as {iso3-language: text}; we prefer `eng` and mark the notice non-English otherwise.
  * Requiring a lot deadline also removes award / result notices.
Two queries run: one on the keyword set (precise), one on the CPV prefixes (broad, capped at CPV_PAGES pages).
The human page is built from the publication number (the `links` field is ~3 kB per notice, so we do not ask for it).
"""
from datetime import date, timedelta

from core.feeds import base, filters
from core.feeds.base import Opp

SOURCE = "ted"
URL = "https://api.ted.europa.eu/v3/notices/search"
PAGE = 100
KEYWORD_PAGES = 5
CPV_PAGES = 5
FIELDS = ["publication-number", "notice-title", "buyer-name", "buyer-country", "publication-date",
          "deadline-receipt-tender-date-lot", "classification-cpv", "estimated-value-lot",
          "estimated-value-cur-lot", "description-lot", "notice-type"]
TED_KEYWORDS = ["scada", "plc", "telemetry", "firmware", "embedded", "iot", "sensor", "data logger", "dashboard",
                "software development", "inventory", "crm", "booking system", "mobile app", "penetration test",
                "reverse engineering", "digital twin", "remote monitoring", "condition monitoring"]


def _ymd(d: date) -> str:
    return d.strftime("%Y%m%d")


def queries(since: date, today: date) -> list[tuple[str, int]]:
    base_q = (f"publication-date>={_ymd(since)} AND "
              f"deadline-receipt-tender-date-lot>={_ymd(today + timedelta(days=filters.MIN_DAYS_TO_DEADLINE))}")
    ft = " OR ".join(f'FT~"{k}"' if " " in k else f"FT~{k}" for k in TED_KEYWORDS)
    cpv = " OR ".join(f"classification-cpv={p}*" for p in filters.CPV_PREFIXES)
    return [(f"{base_q} AND ({ft})", KEYWORD_PAGES), (f"{base_q} AND ({cpv})", CPV_PAGES)]


def parse(n: dict) -> Opp | None:
    pub = n.get("publication-number")
    if not pub:
        return None
    title, title_en = base.pick_lang(n.get("notice-title"))
    desc, _ = base.pick_lang(n.get("description-lot"))
    buyer, _ = base.pick_lang(n.get("buyer-name"))
    countries = n.get("buyer-country") or []
    deadlines = [d for d in (base.parse_dt(x) for x in (n.get("deadline-receipt-tender-date-lot") or [])) if d]
    values = [v for v in (base.num(x) for x in (n.get("estimated-value-lot") or [])) if v]
    cur = (n.get("estimated-value-cur-lot") or [""])[0] if n.get("estimated-value-cur-lot") else ""
    cpvs = list(dict.fromkeys(str(c) for c in (n.get("classification-cpv") or [])))
    return Opp(
        source=SOURCE, source_id=str(pub), title=base.clean_text(title, 300) or str(pub),
        url=f"https://ted.europa.eu/en/notice/-/detail/{pub}", buyer=base.clean_text(buyer, 200),
        country=base.country_code(countries[0]) if countries else "", cpv_or_naics=cpvs,
        published_at=base.parse_dt(n.get("publication-date")), deadline_at=max(deadlines) if deadlines else None,
        value_min=min(values) if values else None, value_max=max(values) if values else None, currency=cur,
        summary=base.clean_text(desc), raw={"notice_type": n.get("notice-type"), "non_english": not title_en},
    )


def fetch(since: date, client=None, today: date | None = None) -> list[Opp]:
    c = client or base.client()
    today = today or date.today()
    out: dict[str, Opp] = {}
    first = True
    for query, pages in queries(since, today):
        for page in range(1, pages + 1):
            if not first:
                base.pause()
            first = False
            body = {"query": query, "fields": FIELDS, "limit": PAGE, "page": page, "scope": "ACTIVE"}
            data = base.request(c, "POST", URL, json=body).json()
            notices = data.get("notices") or []
            for n in notices:
                o = parse(n)
                if o:
                    out.setdefault(o.source_id, o)
            if len(notices) < PAGE:
                break
    return list(out.values())
