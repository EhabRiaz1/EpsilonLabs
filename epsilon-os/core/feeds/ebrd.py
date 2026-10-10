"""EBRD procurement notices (ECEPP public notice search, no login for the listing).

    GET https://ecepp.ebrd.com/delta/noticeSearch.html        (HTML table of all notices, ~3 MB; verified 2026-10-11)
Each <tr>: link viewNotice.html?displayNoticeId=<id> with the title ("Country: title"), notice type, description,
published and deadline (UK time, dd/mm/yyyy hh:mm), status. Only Open notices that are not awards or general
procurement notices are kept. HTML scraping, public data only; if the table layout changes, `parse` finds no
rows and `fetch` raises FeedError so it shows as a failed feed rather than "nothing today".
Eligibility: Pakistan is not an EBRD shareholder country, and EBRD-financed contracts are normally limited to
firms from member countries, so every EBRD notice carries a flag (see eligibility.SOURCE_NOTES).
"""
import re
from datetime import date, datetime, timezone

from core.feeds import base
from core.feeds.base import Opp

SOURCE = "ebrd"
URL = "https://ecepp.ebrd.com/delta/noticeSearch.html"
BASE = "https://ecepp.ebrd.com/delta/"
SKIP_TYPES = ("award", "general procurement", "contract award")
_ROW = re.compile(r"<tr>\s*<td><a href=\"(viewNotice\.html\?displayNoticeId=(\d+))\">(.*?)</a></td>(.*?)</tr>", re.S)
_TD = re.compile(r"<td[^>]*>(.*?)</td>", re.S)


def _dt(s: str) -> datetime | None:
    m = re.search(r"(\d\d)/(\d\d)/(\d{4})(?:\s+(\d\d):(\d\d))?", s or "")
    if not m:
        return None
    d, mo, y, h, mi = m.groups()
    return datetime(int(y), int(mo), int(d), int(h or 12), int(mi or 0), tzinfo=timezone.utc)


def parse(page: str) -> list[Opp]:
    out = []
    for href, nid, title_html, rest in _ROW.findall(page):
        tds = [base.clean_text(x, 1200) for x in _TD.findall(rest)]
        if len(tds) < 5:
            continue
        ntype, desc, published, deadline, status = tds[0], tds[1], tds[2], tds[3], tds[4]
        if status.lower() != "open" or any(w in ntype.lower() for w in SKIP_TYPES):
            continue
        title = base.clean_text(title_html, 300)
        country, _, rest_title = title.partition(": ")
        out.append(Opp(
            source=SOURCE, source_id=nid, title=title, url=BASE + href, buyer="",
            country=base.country_code(country) if rest_title else "", published_at=_dt(published),
            deadline_at=_dt(deadline), summary=desc if desc != "N/A" else "",
            raw={"notice_type": ntype},
        ))
    return out


def fetch(since: date, client=None) -> list[Opp]:
    c = client or base.client()
    page = base.request(c, "GET", URL).text
    opps = parse(page)
    if not opps and "viewNotice" not in page:
        raise base.FeedError("ebrd: no notice rows found (page layout changed?)")
    cutoff = base.as_datetime(since)
    return [o for o in opps if o.published_at is None or o.published_at >= cutoff]
