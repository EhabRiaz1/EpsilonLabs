"""UNGM (United Nations Global Marketplace) public procurement notices.

UNGM has no documented public API. Its public notice search page does its own AJAX call, which we replicate
politely (one request per keyword, a pause between them, a descriptive User-Agent, public data only):

    GET  https://www.ungm.org/Public/Notice          -> sets the antiforgery cookie, page carries the token
    POST https://www.ungm.org/Public/Notice/Search   JSON filter body + header RequestVerificationToken: <token>
         -> an HTML fragment of <div role="row" data-noticeid="..."> result rows            (verified 2026-10-11)

Per row: title (span.ungm-title), deadline (".deadline", local time), published date, agency, notice type,
reference, delivery country. No value, no description in the list: the title and agency are what we have, and
the notice link goes to the full page. This is HTML scraping and can break when UNGM changes its markup:
`parse_rows` returns nothing for an unrecognised page, and `fetch` raises FeedError when the search page itself
looks different from what we expect (no token / no rows container), so the failure shows in the run report
instead of reading as "no tenders today".
"""
import re
from datetime import date, datetime, timezone

from core.feeds import base
from core.feeds.base import Opp

SOURCE = "ungm"
PAGE_URL = "https://www.ungm.org/Public/Notice"
SEARCH_URL = "https://www.ungm.org/Public/Notice/Search"
PAGE_SIZE = 15  # the endpoint rejects other sizes (HTTP 400); we take the newest 15 per search term
TERMS = ["software", "SCADA", "firmware", "IoT", "sensor", "monitoring system", "mobile application", "dashboard",
         "information system", "penetration test", "embedded", "telemetry", "web application", "inventory system"]
_TOKEN = re.compile(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"')
_ROW = re.compile(r'<div role="row"[^>]*data-noticeid="(\d+)"[^>]*>(.*?)(?=<div role="row"|\Z)', re.S)


def _body(term: str, page: int = 0) -> dict:
    return {"PageIndex": page, "PageSize": PAGE_SIZE, "Title": term, "Description": "", "Reference": "",
            "PublishedFrom": "", "PublishedTo": "", "DeadlineFrom": "", "DeadlineTo": "", "Countries": [],
            "Agencies": [], "UNSPSCs": [], "NoticeTypes": [], "SortField": "DatePublished", "SortAscending": False,
            "isPicker": False, "IsSustainable": False, "IsActive": True, "NoticeDisplayType": None,
            "NoticeSearchTotalLabelId": "noticeSearchTotal", "TypeOfCompetitions": []}


def _text(fragment: str) -> str:
    return base.clean_text(re.sub(r"<script.*?</script>|<svg.*?</svg>", " ", fragment, flags=re.S), 300)


def _date(s: str, with_time: bool = False) -> datetime | None:
    m = re.search(r"(\d{1,2}-[A-Za-z]{3}-\d{4})(?:\s+(\d{1,2}:\d\d))?", s or "")
    if not m:
        return None
    try:
        d = datetime.strptime(m.group(1), "%d-%b-%Y")
        if with_time and m.group(2):
            h, mi = m.group(2).split(":")
            d = d.replace(hour=int(h), minute=int(mi))
        else:
            d = d.replace(hour=12)
    except ValueError:
        return None
    return d.replace(tzinfo=timezone.utc)


def parse_rows(fragment: str) -> list[Opp]:
    out = []
    for nid, chunk in _ROW.findall(fragment or ""):
        title_m = re.search(r'class="ungm-title[^"]*"[^>]*>(.*?)</span>', chunk, re.S)
        title = _text(title_m.group(1)) if title_m else ""
        if not title:
            continue
        dl = re.search(r'deadline"[^>]*>\s*<span>(.*?)</span>', chunk, re.S)
        agency = re.search(r'resultAgency"[^>]*>\s*<span>(.*?)</span>', chunk, re.S)
        ref = re.search(r'data-description="Reference"[^>]*>\s*<span>(.*?)</span>', chunk, re.S)
        cells = [_text(c) for c in re.findall(r'<div role="cell" class="tableCell">\s*<span>(.*?)</span>\s*</div>',
                                              chunk, re.S)]
        # plain cells in order: published, notice type, delivery country
        published = _date(cells[0]) if cells else None
        ntype = cells[1] if len(cells) > 1 else ""
        country = cells[2] if len(cells) > 2 else ""
        out.append(Opp(
            source=SOURCE, source_id=nid, title=title, url=f"https://www.ungm.org/Public/Notice/{nid}",
            buyer=_text(agency.group(1)) if agency else "", country=base.country_code(country),
            published_at=published, deadline_at=_date(_text(dl.group(1)), with_time=True) if dl else None,
            summary=f"{ntype}. Delivery country: {country}." if ntype or country else "",
            raw={"reference": _text(ref.group(1)) if ref else "", "notice_type": ntype},
        ))
    return out


def fetch(since: date, client=None, terms: list[str] | None = None) -> list[Opp]:
    c = client or base.client()
    page = base.request(c, "GET", PAGE_URL).text
    m = _TOKEN.search(page)
    if not m:
        raise base.FeedError("ungm: antiforgery token not found (page layout changed?)")
    headers = {"Content-Type": "application/json", "RequestVerificationToken": m.group(1),
               "X-Requested-With": "XMLHttpRequest", "Accept": "text/html, */*"}
    cutoff = base.as_datetime(since)
    out: dict[str, Opp] = {}
    for n, term in enumerate(terms or TERMS):
        if n:
            base.pause()
        frag = base.request(c, "POST", SEARCH_URL, json=_body(term), headers=headers).text
        if "data-noticeid" not in frag and n == 0 and "noticeid" not in frag.lower() and len(frag) > 200:
            raise base.FeedError("ungm: search returned an unrecognised page")
        for o in parse_rows(frag):
            if o.published_at is None or o.published_at >= cutoff:
                out.setdefault(o.source_id, o)
    return list(out.values())
