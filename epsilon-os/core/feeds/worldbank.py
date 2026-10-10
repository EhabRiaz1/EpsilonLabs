"""World Bank procurement notices (projects financed by the Bank; Pakistan is a member country, so its firms
are eligible bidders unless a notice restricts nationality).

    GET https://search.worldbank.org/api/v2/procnotices
        ?format=json&apilang=en&rows=50&os=0&srt=noticedate&order=desc&qterm=<term>     (no key; verified live 2026-10-11)
Response: {"rows", "total", "procnotices": [{id, notice_type, noticedate, notice_status, notice_lang_name,
submission_deadline_date, project_ctry_name, project_id, project_name, bid_reference_no, bid_description,
procurement_group, procurement_method_name, contact_organization, notice_text (HTML), ...}]}.
One search per keyword term, newest first, one page each. Award notices and General Procurement Notices are
skipped (nothing to bid on). Contact names, emails and phones in the response are never stored.
"""
from datetime import date

from core.feeds import base
from core.feeds.base import Opp

SOURCE = "worldbank"
URL = "https://search.worldbank.org/api/v2/procnotices"
ROWS = 50
TERMS = ["software", "information system", "SCADA", "IoT", "sensor", "monitoring system", "mobile application",
         "dashboard", "management information system", "digital platform", "firmware", "cybersecurity"]
SKIP_TYPES = ("award", "general procurement")


def parse(n: dict) -> Opp | None:
    nid = n.get("id")
    if not nid or any(w in (n.get("notice_type") or "").lower() for w in SKIP_TYPES):
        return None
    if (n.get("notice_status") or "Published").lower() not in ("published", "active"):
        return None
    title = base.clean_text(n.get("bid_description") or n.get("project_name"), 300)
    if not title:
        return None
    lang = (n.get("notice_lang_name") or "English")
    body = base.clean_text(n.get("notice_text"), 3000)
    summary = "\n".join(x for x in (f"Project: {n.get('project_name')}" if n.get("project_name") else "", body) if x)
    return Opp(
        source=SOURCE, source_id=str(nid), title=title, buyer=base.clean_text(n.get("contact_organization"), 200),
        url=f"https://projects.worldbank.org/en/projects-operations/procurement-detail/{nid}",
        country=base.country_code(n.get("project_ctry_name")),
        published_at=base.parse_dt(_iso(n.get("noticedate"))) or base.parse_dt(n.get("submission_date")),
        deadline_at=base.parse_dt(n.get("submission_deadline_date")), summary=summary,
        raw={"notice_type": n.get("notice_type"), "method": n.get("procurement_method_name"),
             "group": n.get("procurement_group"), "reference": n.get("bid_reference_no"),
             "project_id": n.get("project_id"), "project_country": n.get("project_ctry_name"),
             "non_english": lang.lower() != "english", "language": lang},
    )


def _iso(s) -> str | None:
    """'28-Sep-2026' -> '2026-09-28'."""
    from datetime import datetime
    try:
        return datetime.strptime(str(s), "%d-%b-%Y").date().isoformat()
    except ValueError:
        return None


def fetch(since: date, client=None, terms: list[str] | None = None) -> list[Opp]:
    c = client or base.client()
    cutoff = base.as_datetime(since)
    out: dict[str, Opp] = {}
    for i, term in enumerate(terms or TERMS):
        if i:
            base.pause()
        params = {"format": "json", "apilang": "en", "rows": ROWS, "os": 0, "srt": "noticedate", "order": "desc",
                  "qterm": term}
        for n in base.request(c, "GET", URL, params=params).json().get("procnotices") or []:
            o = parse(n)
            if o and (o.published_at is None or o.published_at >= cutoff):
                out.setdefault(o.source_id, o)
    return list(out.values())
