"""Pakistan PPRA e-Procurement (EPMS) active federal tenders.

Public, server-rendered HTML, no login and no anti-bot check (verified 2026-10-13):

    GET https://epms.ppra.gov.pk/public/tenders/active-tenders?page=N      50 rows a page, "Page N of M" on the page
                                                                           (2,220 active tenders over 45 pages that day)

Polite by construction: one request at a time with at least PAUSE seconds between them (at most 1 a second), the
shared Epsilon User-Agent (it names our site), and never more than MAX_PAGES pages. agents/tenders.py runs this feed
at most once a day (ONCE_A_DAY), however often the tenders job itself runs.

Per row: tender no (TS...E), title, description lines, category, organisation (procuring office and its parent),
city, advertised date, closing date and time (Pakistan time), and the detail link /public/tenders/tender-details/<no>.
Currency is PKR and the value is almost never stated (kept as unknown, so the value band never drops it).

The listing is not filtered by `since`: it only holds open tenders, and dedupe on (source, tender no) makes a
daily re-read free. Instead a keyword pre-filter keeps only Epsilon's kind of work (INCLUDE) and drops supply and
works lots that merely share a word with it (EXCLUDE, checked first). Organisation names are never matched
("Pakistan Software Export Board" buying stationery is still stationery).

Eligibility hints: PEC registration (for example "PEC C-6"), FBR active-taxpayer status and OEM letters are read
from the row text by core.feeds.eligibility.pk_flags and stored in raw["eligibility_flags"]; eligibility.assess turns
them into notes ("Needs PEC C-6 ...") that the founder sees in Opportunities. Pakistan stays excluded for cold
prospecting (core.settings.ALWAYS_EXCLUDED); public tenders are a different channel and are fine.
"""
import re
from datetime import date, datetime, timedelta, timezone

from core.feeds import base, eligibility
from core.feeds.base import Opp

SOURCE = "ppra_epms"
ORIGIN = "https://epms.ppra.gov.pk"
LIST_URL = ORIGIN + "/public/tenders/active-tenders"
DETAIL_URL = ORIGIN + "/public/tenders/tender-details/{no}"
MAX_PAGES = 50
PAUSE = 1.1                     # seconds between requests: at most one request a second
ONCE_A_DAY = True               # agents/tenders.py: fetch this feed on the first run of the day only
PKT = timezone(timedelta(hours=5))

INCLUDE = re.compile(
    r"\bsoftware\b|\biot\b|internet of things|\bscada\b|\bautomation\b|\bmonitoring\b|\brfid\b|\bbiometric\w*|"
    r"\bdashboards?\b|\bmobile app\w*|\bapps?\b|application development|web portal|portal development|"
    r"\bai\b|artificial intelligence|machine learning|cyber ?security|information security|web security|\bvapt\b|"
    r"penetration test\w*|\bcctv\b|video surveillance|surveillance cameras?|smart met(?:er|ering)\w*|\bami\b|"
    r"automated meter reading|tank gaug\w*|\batg\b|\bmodbus\b|\bplc\b|programmable logic|telemetry|data loggers?", re.I)
EXCLUDE = re.compile(
    r"\bspares?\b|spare parts|\bration\b|medicine|\bmed(?:ical)? disposable|condemn\w*|\bauction\w*|\bdisposal of\b|"
    r"construction|civil works?|renovation|\bbuilding works?\b|excavation|backfill\w*|earthing|\bpoles\b|"
    r"horizontal directional drilling|\bstation(?:e|a)ry\b|furniture|uniforms?|clothing|garments?|\bvehicles?\b|"
    r"\btyres?\b|\btires\b|motor ?cycles?|printing|janitorial|ordnance|ammunition|\bpol\b|lubricants?|"
    r"\bfood\b|catering|fodder|sports items|photostat", re.I)
EXCLUDE_CATEGORIES = {"civil works", "stationery", "furniture/fixture", "clothing/uniform", "printing", "leasing",
                      "chemical items", "consumable items", "civil goods"}
MONTH_DATE = re.compile(r"([A-Z][a-z]{2}) (\d{1,2}), (\d{4})")
TIME = re.compile(r"(\d{1,2}):(\d\d)\s*([AP]M)", re.I)
_ROW = re.compile(r"<tr>(.*?)</tr>", re.S)
_TD = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
_PAGES = re.compile(r"Page\s+(\d+)\s+of\s+(\d+)")


def _t(fragment: str, limit: int = 600) -> str:
    return base.clean_text(re.sub(r"\s+", " ", fragment or ""), limit).strip(" -")


def _date(s: str) -> date | None:
    m = MONTH_DATE.search(s or "")
    if not m:
        return None
    try:
        return datetime.strptime(" ".join(m.groups()), "%b %d %Y").date()
    except ValueError:
        return None


def _closing(cell: str) -> datetime | None:
    d = _date(_t(cell))
    if d is None:
        return None
    m = TIME.search(_t(cell))
    h, mi = (12, 0)
    if m:
        h, mi = int(m.group(1)) % 12 + (12 if m.group(3).upper() == "PM" else 0), int(m.group(2))
    return datetime(d.year, d.month, d.day, h, mi, tzinfo=PKT).astimezone(timezone.utc)


def parse_page(page: str) -> tuple[list[Opp], int | None]:
    """(rows, total pages from "Page N of M" or None). Rows the parser does not recognise are skipped."""
    m = _PAGES.search(page or "")
    total = int(m.group(2)) if m else None
    body = page[page.find("<tbody>"):page.find("</tbody>")] if "<tbody>" in (page or "") else ""
    out = []
    for row in _ROW.findall(body):
        tds = _TD.findall(row)
        if len(tds) < 7:
            continue
        no = re.search(r"\bTS\d{6,}E\b", _t(tds[1]))
        title_m = re.search(r"<strong>(.*?)</strong>", tds[2], re.S)
        if not no or not title_m or not _t(title_m.group(1)):
            continue
        no, title = no.group(0), _t(title_m.group(1), 400)
        lines = [_t(x) for x in re.findall(r'<small class="text-muted d-block">(.*?)</small>', tds[2], re.S)]
        cat_m = re.search(r'<small class="badge bg-light text-dark">(.*?)</small>', tds[2], re.S)
        ref_m = re.search(r'<small class="text-muted badge bg-light text-dark">((?:(?!ri-organization-chart).)*?)</small>', tds[2], re.S)
        parent_m = re.search(r'<small class="text-muted text-dark d-block">(.*?)</small>', tds[3], re.S)
        office_m = re.search(r'tender-org[^"]*">(.*?)</span>', tds[3], re.S)
        city_m = re.search(r'ri-map-pin-line"></i>(.*?)</small>', tds[3], re.S)
        category = _t(cat_m.group(1), 80) if cat_m else ""
        parent, office = (_t(parent_m.group(1), 160) if parent_m else ""), (_t(office_m.group(1), 160) if office_m else "")
        city = re.sub(r"[.\s]*-\s*Pakistan\s*$", "", _t(city_m.group(1), 120)).strip(" .") if city_m else ""
        desc = []
        for ln in lines:   # the second line is usually a truncated copy ("...") of the first or of the title
            stem = ln.rstrip(".").rstrip("…").strip()
            if ln and ln != "-" and not any(stem and x.startswith(stem) for x in desc + [title]):
                desc.append(ln)
        buyer = parent if not office or office.lower() in parent.lower() else f"{office}, {parent}" if parent else office
        published = _date(_t(tds[5]))
        deadline = _closing(tds[6])
        text = "\n".join([title] + desc)
        summary = "\n".join(desc) + ("\n" if desc else "") + \
            f"Category: {category or 'not stated'}. Procuring office: {office or parent}. City: {city or 'not stated'}. " \
            f"Closing: {_t(tds[6])} (Pakistan time). Value: not stated (PKR)."
        out.append(Opp(
            source=SOURCE, source_id=no, title=title, url=DETAIL_URL.format(no=no), buyer=buyer[:200], country="PK",
            published_at=base.as_datetime(published).replace(hour=12) if published else None, deadline_at=deadline,
            currency="PKR", summary=summary,
            raw={"tender_no": no, "category": category, "organisation": parent, "office": office, "city": city,
                 "reference": _t(ref_m.group(1), 120) if ref_m else "", "status": _t(tds[4], 60),
                 "eligibility_flags": eligibility.pk_flags(text)},
        ))
    return out, total


def wanted(o: Opp) -> bool:
    """Keyword pre-filter on what the buyer wrote (title and description, never the organisation name)."""
    text = f"{o.title}\n{o.summary.split('Category:')[0]}"
    if EXCLUDE.search(text) or (o.raw or {}).get("category", "").lower() in EXCLUDE_CATEGORIES:
        return False
    return bool(INCLUDE.search(text))


def fetch(since: date, client=None, max_pages: int = MAX_PAGES) -> list[Opp]:
    c = client or base.client()
    out: dict[str, Opp] = {}
    total, page = None, 1
    while page <= min(max_pages, total or max_pages):
        if page > 1:
            base._sleep(PAUSE)
        html = base.request(c, "GET", LIST_URL, params={"page": page}).text
        rows, pages = parse_page(html)
        if page == 1 and (pages is None or (not rows and "<tbody>" not in html)):
            raise base.FeedError("ppra_epms: listing page not recognised (layout changed?)")
        total = pages or total
        if not rows:
            break
        for o in rows:
            if wanted(o):
                out.setdefault(o.source_id, o)
        page += 1
    return list(out.values())
